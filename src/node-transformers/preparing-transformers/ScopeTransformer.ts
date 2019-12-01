import { inject, injectable, } from 'inversify';
import { ServiceIdentifiers } from '../../container/ServiceIdentifiers';

import * as eslintScope from 'eslint-scope';
import * as espree from 'espree';
import * as ESTree from 'estree';

import { IOptions } from '../../interfaces/options/IOptions';
import { IRandomGenerator } from '../../interfaces/utils/IRandomGenerator';
import { IVisitor } from '../../interfaces/node-transformers/IVisitor';

import { TransformationStage } from '../../enums/node-transformers/TransformationStage';

import { AbstractNodeTransformer } from '../AbstractNodeTransformer';
import { ObfuscationTarget } from '../../enums/ObfuscationTarget';
import { NodeGuards } from '../../node/NodeGuards';

/**
 * Analyzes scopes of nodes and attaches it to the `scope` property of the node.
 */
@injectable()
export class ScopeTransformer extends AbstractNodeTransformer {
    /**
     * @type {eslintScope.AnalysisOptions}
     */
    private static readonly eslintScopeOptions: eslintScope.AnalysisOptions = {
        ecmaVersion: 7,
        optimistic: true
    };

    /**
     * @type {espree.SourceType[]}
     */
    private static readonly sourceTypes: espree.SourceType[] = [
        'script',
        'module'
    ];

    /**
     * @type {eslintScope.ScopeManager | null}
     */
    private scopeManager: eslintScope.ScopeManager | null = null;

    /**
     * @param {IRandomGenerator} randomGenerator
     * @param {IOptions} options
     */
    constructor (
        @inject(ServiceIdentifiers.IRandomGenerator) randomGenerator: IRandomGenerator,
        @inject(ServiceIdentifiers.IOptions) options: IOptions
    ) {
        super(randomGenerator, options);
    }

    /**
     * @param {eslintScope.ScopeManager} scopeManager
     * @param {Identifier} targetIdentifierNode
     * @returns {eslintScope.Scope}
     */
    private static getScope (
        scopeManager: eslintScope.ScopeManager,
        targetIdentifierNode: ESTree.Identifier
    ): eslintScope.Scope {
        for (let node: ESTree.Node | undefined = targetIdentifierNode; node; node = node.parentNode) {
            if (!node.parentNode) {
                throw new Error('`parentNode` property of given node is `undefined`');
            }

            const scope: eslintScope.Scope | null = scopeManager.acquire(
                node,
                ScopeTransformer.isRootNode(targetIdentifierNode)
            );

            /**
             * Node without scope.
             * Should look for upper node
             */
            if (!scope) {
                if (ScopeTransformer.isRootNode(node)) {
                    break;
                } else {
                    continue;
                }
            }

            const isVariable: boolean = scope.variables.some((variable: eslintScope.Variable) =>
                variable.name === targetIdentifierNode.name
                    && variable.identifiers.includes(targetIdentifierNode)
            );

            /**
             * Node with scope.
             * Should look for `variables` field to check - this is scope of current variable or not
             */
            if (isVariable) {
                return scope;
            }

            /**
             * Node with scope.
             * Should look for `references` field to find scope of declaration
             */
            const foundReference: eslintScope.Reference | undefined = scope.references
                    .find((reference: eslintScope.Reference) => reference.identifier === targetIdentifierNode);

            if (foundReference) {
                return foundReference.from;
            }

            if (ScopeTransformer.isRootNode(node)) {
                break;
            }
        }

        return scopeManager.scopes[0];
    }

    /**
     * @param {Node} node
     * @returns {boolean}
     */
    private static isRootNode (node: ESTree.Node): boolean {
        return NodeGuards.isProgramNode(node) || node.parentNode === node;
    }

    /**
     * @param {TransformationStage} transformationStage
     * @returns {IVisitor | null}
     */
    public getVisitor (transformationStage: TransformationStage): IVisitor | null {
        if (transformationStage !== TransformationStage.Preparing) {
            return null;
        }

        return {
            enter: (node: ESTree.Node, parentNode: ESTree.Node | null) => {
                if (NodeGuards.isProgramNode(node)) {
                    this.analyzeNode(node, parentNode);
                }

                if (NodeGuards.isIdentifierNode(node)) {
                    return this.transformNode(node, parentNode);
                }
            }
        };
    }

    /**
     * @param {Node} node
     * @param {Node | null} parentNode
     * @returns {Node}
     */
    public analyzeNode (node: ESTree.Node, parentNode: ESTree.Node | null): void | never {
        const sourceTypeLength: number = ScopeTransformer.sourceTypes.length;

        for (let i: number = 0; i < sourceTypeLength; i++) {
            try {
                this.scopeManager = eslintScope.analyze(node, {
                    ...ScopeTransformer.eslintScopeOptions,
                    nodejsScope: this.options.target === ObfuscationTarget.Node,
                    sourceType: ScopeTransformer.sourceTypes[i]
                });

                return;
            } catch (error) {
                if (i < sourceTypeLength - 1) {
                    continue;
                }

                throw new Error(error);
            }
        }

        throw new Error(`Scope analyzing error`);
    }

    /**
     * @param {identifier} identifierNode
     * @param {Node | null} parentNode
     * @returns {Node}
     */
    public transformNode (identifierNode: ESTree.Identifier, parentNode: ESTree.Node | null): ESTree.Node {
        if (!this.scopeManager) {
            return identifierNode;
        }

        identifierNode.scope = ScopeTransformer.getScope(this.scopeManager, identifierNode);

        return identifierNode;
    }
}
