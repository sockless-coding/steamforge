// Registers every built-in component handler. New components: add a module here and use its kind in content.
import './basic'
import './gatherer'
import './producer'
import './field'
import './energy'
import './research'

export { componentHandler, knownComponents, registerComponent, type ComponentHandler } from './registry'
