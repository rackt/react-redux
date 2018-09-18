import hoistStatics from 'hoist-non-react-statics'
import invariant from 'invariant'
import React, {Component, PureComponent} from 'react'
import propTypes from 'prop-types'
import {isValidElementType} from 'react-is'

import Context from './Context'

const ReduxConsumer = Context.Consumer

const createGetter = (source, callback) => {
  const getter = {}

  Object
    .getOwnPropertyNames(source)
    .forEach(key => getter[key] = {
      get: () => callback(key),
      enumerable: true
    })

  return getter
};

export default function connectAdvanced(
  /*
    selectorFactory is a func that is responsible for returning the selector function used to
    compute new props from state, props, and dispatch. For example:

      export default connectAdvanced((dispatch, options) => (state, props) => ({
        thing: state.things[props.thingId],
        saveThing: fields => dispatch(actionCreators.saveThing(props.thingId, fields)),
      }))(YourComponent)

    Access to dispatch is provided to the factory so selectorFactories can bind actionCreators
    outside of their selector as an optimization. Options passed to connectAdvanced are passed to
    the selectorFactory, along with displayName and WrappedComponent, as the second argument.

    Note that selectorFactory is responsible for all caching/memoization of inbound and outbound
    props. Do not use connectAdvanced directly without memoizing results between calls to your
    selector, otherwise the Connect component will re-render on every state or props change.
  */
  selectorFactory,
  // options object:
  {
    // the func used to compute this HOC's displayName from the wrapped component's displayName.
    // probably overridden by wrapper functions such as connect()
    getDisplayName = name => `ConnectAdvanced(${name})`,

    // shown in error messages
    // probably overridden by wrapper functions such as connect()
    methodName = 'connectAdvanced',

    // if defined, the name of the property passed to the wrapped element indicating the number of
    // calls to render. useful for watching in react devtools for unnecessary re-renders.
    renderCountProp = undefined,

    // determines whether this HOC subscribes to store changes
    shouldHandleStateChanges = true,

    // the key of props/context to get the store [**does nothing, use consumer**]
    storeKey = 'store',

    // if true, the wrapped element is exposed by this HOC via the getWrappedInstance() function.
    withRef = false,

    // the context consumer to use
    consumer = ReduxConsumer,

    // additional options are passed through to the selectorFactory
    ...connectOptions
  } = {}
) {
  invariant(renderCountProp === undefined,
    `renderCountProp is removed. render counting is built into the latest React dev tools profiling extension`
  )

  invariant(storeKey === 'store',
    'storeKey has been removed and does not do anything. To use a custom redux store for a single component, ' +
    'create a custom React context with React.createContext() and pass the Provider to react-redux\'s provider ' +
    'and the Consumer to this component as in <Provider context={context.Provider}><' +
    'ConnectedComponent consumer={context.Consumer} /></Provider>'
  )

  const Consumer = consumer

  return function wrapWithConnect(WrappedComponent) {
    invariant(
      isValidElementType(WrappedComponent),
      `You must pass a component to the function returned by ` +
      `${methodName}. Instead received ${JSON.stringify(WrappedComponent)}`
    )
    invariant(!withRef || withRef === 'forwardRef',
      'withRef must be set to the text "forwardRef." Reference uses React.forwardRef and you may now access ref ' +
      `directly instead of using getWrappedInstance() in component ${wrappedComponentName}`
    )

    const wrappedComponentName = WrappedComponent.displayName
      || WrappedComponent.name
      || 'Component'

    const displayName = getDisplayName(wrappedComponentName)


    class PureWrapper extends Component {
      shouldComponentUpdate(nextProps) {
        return nextProps.derivedProps !== this.props.derivedProps
      }

      componentDidUpdate(prevProps) {
        if (prevProps.observedBits !== this.props.observedBits) {
          this.props.setObservedBits(this.props.observedBits)
        }
      }

      render() {
        let {forwardRef, derivedProps} = this.props
        return withRef
          ? <WrappedComponent {...derivedProps} ref={forwardRef}/>
          : <WrappedComponent {...derivedProps}/>
      }
    }

    PureWrapper.propTypes = {
      observedProps: propTypes.number,
      setObservedBits: propTypes.func,
      derivedProps: propTypes.object,
      forwardRef: propTypes.oneOfType([
        propTypes.func,
        propTypes.object
      ]),
    }

    const selectorFactoryOptions = {
      ...connectOptions,
      getDisplayName,
      methodName,
      renderCountProp,
      shouldHandleStateChanges,
      storeKey,
      withRef,
      displayName,
      wrappedComponentName,
      WrappedComponent
    }

    const OuterBase = connectOptions.pure ? PureComponent : Component

    const ALL_BITS = 0xFFFFFFFF;

    class Connect extends OuterBase {
      constructor(props) {
        super(props)
        invariant(withRef ? !props.props[storeKey] : !props[storeKey],
          'Passing redux store in props has been removed and does not do anything. ' +
          'To use a custom redux store for a single component, ' +
          'create a custom React context with React.createContext() and pass the Provider to react-redux\'s provider ' +
          'and the Consumer to this component\'s connect as in <Provider context={context.Provider}></Provider>' +
          ` and connect(mapState, mapDispatch, undefined, { consumer=context.consumer })(${wrappedComponentName})`
        )
        this.generatedDerivedProps = this.makeDerivedPropsGenerator()
        this.renderWrappedComponent = this.renderWrappedComponent.bind(this)
        this.setObservedBits = this.setObservedBits.bind(this)

        this.state = {
          observedBits: ALL_BITS
        }
      }

      setObservedBits(bits) {
        if (!connectOptions.observer && (bits || !selectorFactory)) {
          this.setState(state => {
            if (state.observedBits !== bits) {
              return {
                observedBits: 6 | bits
              }
            }
            return null;
          })
        }
      }

      makeDerivedPropsGenerator() {
        let lastProps
        let lastState
        let lastDerivedProps
        let lastStore
        let lastHashFunction
        let sourceSelector
        let stateGetter
        let observedBits
        let lastObservedBits;
        return (state, props, store, hashFunction) => {
          if ((connectOptions.pure && lastProps === props) && (lastState === state)) {
            return lastDerivedProps
          }
          if (store !== lastStore) {
            lastStore = store
            sourceSelector = selectorFactory(store.dispatch, selectorFactoryOptions)
          }

          if (hashFunction !== lastHashFunction) {
            stateGetter = createGetter(state, key => {
              observedBits = hashFunction(observedBits, key)
              return lastState[key]
            })
            lastHashFunction = hashFunction
          }
          if (lastProps !== props || lastState !== state) {
            lastProps = props
            lastState = state

            observedBits = 0
            const couldProxyState = typeof state === 'object' && !Array.isArray(state)
            if (couldProxyState) {
              const stateProxy = {}
              Object.defineProperties(stateProxy, stateGetter);
              lastDerivedProps = sourceSelector(stateProxy, props)
              lastObservedBits = observedBits;
            } else {
              lastDerivedProps = sourceSelector(state, props)
              lastObservedBits = ALL_BITS;
            }
          }

          return {
            derivedProps: lastDerivedProps,
            observedBits: lastObservedBits
          }
        }
      }

      renderWrappedComponentWithRef(value) {
        invariant(value,
          `Could not find "store" in the context of ` +
          `"${displayName}". Either wrap the root component in a <Provider>, ` +
          `or pass a custom React context provider to <Provider> and the corresponding ` +
          `React context consumer to ${displayName} in connect options.`
        )
        const {state, store, hashFunction} = value
        const {forwardRef, props} = this.props
        let {derivedProps, observedBits} = this.generatedDerivedProps(state, props, store, hashFunction)
        if (connectOptions.pure) {
          return (
            <PureWrapper
              derivedProps={derivedProps}
              observedBits={observedBits}
              setObservedBits={this.setObservedBits}
              forwardRef={forwardRef}
            />
          )
        }

        return <WrappedComponent {...derivedProps} ref={forwardRef}/>
      }

      renderWrappedComponent(value) {
        invariant(value,
          `Could not find "store" in the context of ` +
          `"${displayName}". Either wrap the root component in a <Provider>, ` +
          `or pass a custom React context provider to <Provider> and the corresponding ` +
          `React context consumer to ${displayName} in connect options.`
        )
        const {state, store, hashFunction} = value
        let {derivedProps, observedBits} = this.generatedDerivedProps(state, this.props, store, hashFunction)
        if (connectOptions.pure) {
          return (
            <PureWrapper
              derivedProps={derivedProps}
              observedBits={observedBits}
              setObservedBits={this.setObservedBits}
            />
          )
        }

        return <WrappedComponent {...derivedProps} />
      }

      render() {
        if (this.state.observedBits !== ALL_BITS) {
          return (
            <Consumer unstable_observedBits={this.state.observedBits}>
              {this.renderWrappedComponent}
            </Consumer>
          )
        }
        return (
          <Consumer>
            {this.renderWrappedComponent}
          </Consumer>
        )
      }
    }

    Connect.WrappedComponent = WrappedComponent
    Connect.displayName = displayName
    if (withRef) {
      Connect.prototype.renderWrappedComponent = Connect.prototype.renderWrappedComponentWithRef
      Connect.propTypes = {
        props: propTypes.object,
        forwardRef: propTypes.oneOfType([
          propTypes.func,
          propTypes.object
        ])
      }
    }

    if (!withRef) {
      return hoistStatics(Connect, WrappedComponent)
    }

    function forwardRef(props, ref) {
      return <Connect props={props} forwardRef={ref}/>
    }

    const forwarded = React.forwardRef(forwardRef)
    forwarded.displayName = displayName
    forwarded.WrappedComponent = WrappedComponent
    return hoistStatics(forwarded, WrappedComponent)
  }
}
