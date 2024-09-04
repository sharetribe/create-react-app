/* eslint-disable no-param-reassign */

//import balanced from 'balanced-match';
const balanced = require('balanced-match');

const RE_PROP_SET = /^(--)([\w-]+)(\s*)([:]?)$/;

class Visitor {
  cache = {};
  result = {};
  options = {};

  defaults = {
    preserve: false,
    sets: {},
  };

  constructor(options) {
    this.options = {
      ...this.defaults,
      ...options,
    };
  }

  /**
   * This collects variables with deprecated Property Sets syntax from ":root" node.
   * 
   * @param {*} decl declaration 
   * @param {*} cache cache of found CSS Property Sets
   * @param {*} theParent ":root" node
   */
  collectVariablesFromDecl = (decl, cache, theParent, helpers) => {
    const declValue = decl.value;

    const matches = RE_PROP_SET.exec(decl.prop)
    const containsCurlyBracket = s => /^\{/.test(s);

    // TODO test vs exec
    const hasSet = containsCurlyBracket(declValue) && matches;
    if (hasSet) {
      removeCommentBefore(decl);
      const setName = matches[2];

      // extract the contents of balanced curly brackets
      const declContent = balanced('{', '}', declValue);
      const setOfDeclarations = declContent.body;

      const rootOfSet = helpers.parse(setOfDeclarations);

      // Set correct source for parsed nodes
      rootOfSet.each(node => {
        node.source = decl.source
      })

      // Create a new rule that gets all the parsed nodes as children
      let newRule = new helpers.Rule({ selector: `--${setName}`, source: decl.source, parent: theParent })
      newRule.append(rootOfSet.nodes)
      cache[setName] = newRule;


      // If there's a "post" string after extracted content (declContent.body),
      // parse that with postcss.parse (helpers.parse)
      if (declContent.post?.length > 0) {
        // This is needed since PostCSS considers everything between "--varName:" and ";" as value for the variable.
        const rootOfPost = helpers.parse(declContent.post);
        rootOfPost.each(node => {
          node.source = decl.source
          if (node.type === 'decl' && containsCurlyBracket(node.value)) {
            // If another Property Set is found, collect it recursively
            this.collectVariablesFromDecl(node, cache, theParent, helpers);
          } else {
            // If the node doesn't exist already (PostCSS causes loops since it revisits changed nodes),
            // we add the found node (most likely Custom CSS Propery) after the current set declaration.
            if (!theParent.some(d => d.prop === node.prop)) {
              decl.after(node)
            }              
          }
        });
      }
      // remove CSS Property Sets from output
      decl.remove();
    }
  }

  /**
   * Collect all `:root` declared property sets and save them.
   */
  collect = (decl, helpers) => {
    const matches = RE_PROP_SET.exec(decl.prop);

    if (!matches) {
      return;
    }

    const setName = matches[2];
    const { parent, value } = decl;

    if (value?.indexOf('{') === 0 && parent.selector !== ':root') {
      decl.warn(
        this.result,
        'Custom property set ignored: not scoped to top-level `:root` ' +
          `(--${setName}` +
          `${parent.type === 'rule' ? ` declared in ${parent.selector}` : ''})`
      );

      if (parent.type === 'root') {
        decl.remove();
      }

      return;
    }

    this.collectVariablesFromDecl(decl, this.cache, parent, helpers);

    // If the last node is property set, the previous declaration might miss semicolon.
    // Helper: correctly handle property sets removal and semi-colons.
    // @See: postcss/postcss#1014
    if (!parent.last?.ownSemicolon) {
      parent.raws.semicolon = true;
      parent.raws.after = '\n'
    }

    if (!parent.nodes.length) {
      parent.remove();
    }
  };

  /**
   * Collect all `:root` declared property sets and save them.
   */
  collectRules = rule => {
    const matches = RE_PROP_SET.exec(rule.selector);

    if (!matches) {
      return;
    }

    const setName = matches[2];
    const { parent } = rule;

    if (parent.selector !== ':root') {
      rule.warn(
        this.result,
        'Custom property set ignored: not scoped to top-level `:root` ' +
          `(--${setName}` +
          `${parent.type === 'rule' ? ` declared in ${parent.selector}` : ''})`
      );

      // TODO: this is covered in collect().
      // if (parent.type === 'root') {
      //   rule.remove();
      // }

      return;
    }

    // Custom property sets override each other wholly,
    // rather than cascading together like colliding style rules do.
    // @see: https://tabatkins.github.io/specs/css-apply-rule/#defining
    const newRule = rule.clone();
    this.cache[setName] = newRule;

    if (!this.options.preserve) {
      removeCommentBefore(rule);
      safeRemoveRule(rule);
    }

    if (!parent.nodes.length) {
      parent.remove();
    }
  };

  /**
   * Replace nested `@apply` at-rules declarations.
   */
  resolveNested = () => {
    Object.keys(this.cache).forEach(rule => {
      this.cache[rule].walkAtRules('apply', atRule => {
        this.resolve(atRule);

        // @TODO honor `preserve` option.
        atRule.remove();
      });
    });
  };

  /**
   * Replace `@apply` at-rules declarations with provided custom property set.
   */
  resolve = atRule => {
    let ancestor = atRule.parent;

    while (ancestor && ancestor.type !== 'rule') {
      ancestor = ancestor.parent;
    }

    if (!ancestor) {
      atRule.warn(
        this.result,
        'The @apply rule can only be declared inside Rule type nodes.'
      );

      atRule.remove();
      return;
    }

    // // TODO: This doesn't make sense. 
    // // If the parent of @apply rule is Prop Set definition, it should be resolved instead of bypassed
    // if (isDefinition(atRule.parent)) {
    //   return;
    // }

    const param = getParamValue(atRule.params);
    const matches = RE_PROP_SET.exec(param);

    if (!matches) {
      return;
    }

    const setName = matches[2];

    if (!(setName in this.cache)) {
      atRule.warn(
        this.result,
        `No custom property set declared for \`${setName}\`.`
      );

      return;
    }

    const newRule = this.cache[setName].clone();
    cleanIndent(newRule);

    // const { parent } = atRule;
    // if (this.options.preserve) {
    //   parent.insertBefore(atRule, newRule.nodes);

    //   return;
    // }

    atRule.replaceWith(newRule.nodes);
  };
}

// /**
//  * Helper: return whether the rule is a custom property set definition.
//  */
// function isDefinition(rule) {
//   console.log('QWERQWER', !!rule.selector, rule.selector, !!RE_PROP_SET.exec(rule.selector), !!rule.parent, !!rule.parent?.selector), rule.parent?.selector === ':root';
//   return (
//     !!rule.selector &&
//     !!RE_PROP_SET.exec(rule.selector) &&
//     rule.parent &&
//     !!rule.parent.selector &&
//     rule.parent.selector === ':root'
//   );
// }

/**
 * Helper: allow parens usage in `@apply` AtRule declaration.
 * This is for Polymer integration.
 */
function getParamValue(param) {
  return /^\(/.test(param) ? balanced('(', ')', param).body : param;
}

/**
 * Helper: remove excessive declarations indentation.
 */
function cleanIndent(rule) {
  rule.walkDecls(decl => {
    if (typeof decl.raws.before === 'string') {
      const whiteSpaceIndent = /[^\S\n\r]{2,}/
      const match = whiteSpaceIndent.exec(decl.parent.raws.before);
      decl.raws.before = decl.raws.before.replace(whiteSpaceIndent, match ? `  ${match[0]}` : '  ');
    }
  });
}

/**
 * Helper: correctly handle property sets removal and semi-colons.
 * @See: postcss/postcss#1014
 */
function safeRemoveRule(rule) {
  if (rule === rule.parent.last && rule.raws.ownSemicolon) {
    rule.parent.raws.semicolon = true;
  }

  rule.remove();
}

/**
 * Helper: remove immediate preceding comments.
 */
function removeCommentBefore(node) {
  const previousNode = node.prev();

  if (previousNode && previousNode.type === 'comment') {
    previousNode.remove();
  }
}

module.exports = Visitor;
