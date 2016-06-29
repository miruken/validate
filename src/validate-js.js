import {
    True, Undefined, Abstract,
    Metadata, MetaStep, MetaMacro,
    Invoking, $isFunction, $use
} from 'miruken-core';

import { CallbackHandler, $composer } from 'miruken-callback';
import { Validator } from './validate';
import validatejs from 'validate.js';

validatejs.Promise = Promise;

/**
 * Shortcut to indicate required property.
 * @property {Object} $required
 * @readOnly
 * @for miruken.validate.$ 
 */
export const $required = Object.freeze({ presence: true });

/**
 * Shortcut to indicate nested validation.
 * @property {Object} $nested
 * @readOnly
 * @for miruken.validate.$ 
 */
export const $nested = Object.freeze({ nested: true });

validatejs.validators.nested = Undefined;

/**
 * Metamacro to register custom validators with [validate.js](http://validatejs.org).
 * <pre>
 *    const CustomValidators = Base.extend($registerValidators, {
 *        uniqueUserName: [Database, function (db, userName) {
 *            if (db.hasUserName(userName)) {
 *               return "UserName " + userName + " is already taken";
 *            }
 *        }]
 *    })
 * </pre>
 * would register a uniqueUserName validator with a Database dependency.
 * @class $registerValidators
 * @extends miruken.MetaMacro
 */    
export const $registerValidators = MetaMacro.extend({
    execute(step, metadata, target, definition) {
        if (step === MetaStep.Subclass || step === MetaStep.Implement) {
            for (let name in definition) {
                let validator = definition[name];
                if (Array.isArray(validator)) {
                    const dependencies = validator.slice(0);
                    validator = dependencies.pop();
                    if (!$isFunction(validator)) {
                        continue;
                    }
                    if (dependencies.length > 0) {
                        const fn = validator;
                        validator = function (...args) {
                            if (!$composer) {
                                throw new Error(`Unable to invoke validator '${nm}'.`);
                            }
                            const d = dependencies.concat(args.map($use));
                            return Invoking($composer).invoke(fn, d);
                        };
                    }
                }
                if ($isFunction(validator)) {
                    validatejs.validators[name] = validator;
                }
            }
        }
    },
    /**
     * Determines if the macro should be inherited
     * @method shouldInherit
     * @returns {boolean} true
     */        
    shouldInherit: True,
    /**
     * Determines if the macro should be applied on extension.
     * @method isActive
     * @returns {boolean} true
     */        
    isActive: True
});

/**
 * Base class to define custom validators using
 * {{#crossLink "miruken.validate.$registerValidators"}}{{/crossLink}}.
 * <pre>
 *    const CustomValidators = ValidationRegistry.extend({
 *        creditCardNumber: function (cardNumber, options, key, attributes) {
 *           // do the check...
 *        }
 *    })
 * </pre>
 * would register a creditCardNumber validator function.
 * @class ValidationRegistry
 * @constructor
 * @extends Abstract
 */        
export const ValidationRegistry = Abstract.extend($registerValidators);

const DETAILED    = { format: "detailed", cleanAttributes: false },
      VALIDATABLE = { validate: undefined };

/**
 * CallbackHandler for performing validation using [validate.js](http://validatejs.org)
 * <p>
 * Classes participate in validation by declaring **validate** constraints on properties.
 * </p>
 * <pre>
 * const Address = Base.extend({
 *     $properties: {
 *         line:    { <b>validate</b>: { presence: true } },
 *         city:    { <b>validate</b>: { presence: true } },
 *         state:   { 
 *             <b>validate</b>: {
 *                 presence: true,
 *                 length: { is: 2 }
 *             }
 *         },
 *         zipcode: { 
 *             <b>validate</b>: {
 *                 presence: true,
 *                 length: { is: 5 }
 *         }
 *     }
 * })
 * </pre>
 * @class ValidateJsCallbackHandler
 * @extends miruken.callback.CallbackHandler
 */            
export const ValidateJsCallbackHandler = CallbackHandler.extend({
    $validate: [
        null,  function (validation, composer) {
            const target      = validation.object,
                  nested      = {},
                  constraints = _buildConstraints(target, nested);
            if (constraints) {
                const scope     = validation.scope,
                      results   = validation.results,
                      validator = Validator(composer); 
                if (validation.isAsync) {
                    return validatejs.async(target, constraints, DETAILED)
                        .then(valid => _validateNestedAsync(validator, scope, results, nested))
                    	.catch(errors => {
                            if (errors instanceof Error) {
                                return Promise.reject(errors);
                            }
                            return _validateNestedAsync(validator, scope, results, nested).then(function () {
                                _mapResults(results, errors);
                            });
                        });
                } else {
                    const errors = validatejs(target, constraints, DETAILED);
                    for (let key in nested) {
                        const child = nested[key];
                        if (Array.isArray(child)) {
                            for (let i = 0; i < child.length; ++i) {
                                validator.validate(child[i], scope, results.addKey(key + '.' + i));
                            }
                        } else {
                            validator.validate(child, scope, results.addKey(key));
                        }
                    }
                    _mapResults(results, errors);
                }
            }
        }]
});

function _validateNestedAsync(validator, scope, results, nested) {
    const pending = [];
    for (let key in nested) {
        const child = nested[key];
        if (Array.isArray(child)) {
            for (let i = 0; i < child.length; ++i) {
                let childResults = results.addKey(key + '.' + i);
                childResults = validator.validateAsync(child[i], scope, childResults);
                pending.push(childResults);
            }
        } else {
            let childResults = results.addKey(key);
            childResults = validator.validateAsync(child, scope, childResults);
            pending.push(childResults);
        }
    }
    return Promise.all(pending);
}

function _mapResults(results, errors) {
    if (errors) {
        errors.forEach(error => {
            results.addKey(error.attribute).addError(error.validator, {
                message: error.error,
                value:   error.value 
            });
        });
    }
}

function _buildConstraints(target, nested) {
    const meta        = target[Metadata],
          descriptors = meta && meta.getDescriptor(VALIDATABLE);
    let  constraints;
    if (descriptors) {
        for (let key in descriptors) {
            const descriptor = descriptors[key],
                  validate   = descriptor.validate;
            (constraints || (constraints = {}))[key] = validate;
            for (let name in validate) {
                if (name === 'nested') {
                    const child = target[key];
                    if (child) {
                        nested[key] = child;
                    }
                } else if (!(name in validatejs.validators)) {
                    validatejs.validators[name] = function (...args) {
                        const validator = $composer && $composer.resolve(name);
                        if (!validator) {
                            throw new Error(`Unable to resolve validator '${name}'.`);
                        }
                        return validator.validate(...args);
                    };
                }
            }
        }
        return constraints;
    }
}
