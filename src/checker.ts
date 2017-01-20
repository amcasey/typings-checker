import * as ts from 'typescript';
import * as _ from 'lodash';

interface TypeAssertion {
  kind: 'type';
  type: string;
  line: number;  // line that the assertion applies to; 0-based.
}

interface ErrorAssertion {
  kind: 'error';
  pattern: string;
  line: number;  // line that the assertion applies to; 0-based.
}

type Assertion = TypeAssertion | ErrorAssertion;

export interface NodedAssertion {
  assertion: Assertion;
  node: ts.Node;
  type: ts.Type;
  error?: ts.Diagnostic;
}

interface LineNumber {
  line: number;  // 0-based
}

export interface WrongTypeFailure extends LineNumber {
  type: 'WRONG_TYPE';
  expectedType: string;
  actualType: string;
}

export interface UnexpectedErrorFailure extends LineNumber {
  type: 'UNEXPECTED_ERROR';
  message: string;
}

export interface WrongErrorFailure extends LineNumber {
  type: 'WRONG_ERROR';
  expectedMessage: string;
  actualMessage: string;
}

export interface MissingErrorFailure extends LineNumber {
  type: 'MISSING_ERROR';
  message: string;
}

type Failure = WrongTypeFailure | UnexpectedErrorFailure | WrongErrorFailure | MissingErrorFailure;

export interface Report {
  numSuccesses: number;
  failures: Failure[];
}

// Extract information about the type/error assertions in a source file.
// The scanner should be positioned at the start of the file.
export function extractAssertions(scanner: ts.Scanner, source: ts.SourceFile): Assertion[] {
  const assertions = [] as Assertion[];

  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    if (scanner.getToken() === ts.SyntaxKind.SingleLineCommentTrivia) {
      const commentText = scanner.getTokenText();
      const m = commentText.match(/^\/\/ \$Expect(Type|Error) (.*)/);
      if (!m) continue;

      const pos = scanner.getTokenPos();
      let { line } = source.getLineAndCharacterOfPosition(pos);
      line++;  // the assertion applies to the next line.

      const [, kind, text] = m;
      if (kind === 'Type') {
        assertions.push({ kind: 'type', type: text, line });
      } else if (kind === 'Error') {
        assertions.push({ kind: 'error', pattern: text, line });
      }
    }
  }
  return assertions;
}

export function attachNodesToAssertions(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  assertions: Assertion[]
): NodedAssertion[] {
  const nodedAssertions = [] as NodedAssertion[];

  function collectNodes(node: ts.Node) {
    if (node.kind >= ts.SyntaxKind.VariableStatement &&
        node.kind <= ts.SyntaxKind.DebuggerStatement) {
      const pos = node.getStart();
      const { line } = source.getLineAndCharacterOfPosition(pos);

      const assertionIndex = _.findIndex(assertions, {line});
      if (assertionIndex >= 0) {
        const assertion = assertions[assertionIndex];
        const type = checker.getTypeAtLocation(node.getChildren()[0]);
        nodedAssertions.push({ node, assertion, type });
        assertions.splice(assertionIndex, 1);
      }
    }

    ts.forEachChild(node, node => { collectNodes(node); });
    return nodedAssertions;
  }

  collectNodes(source);
  if (assertions.length) {
    console.error(assertions);
    throw new Error('Unable to attach nodes to all assertions.');
  }

  return nodedAssertions;
}

export function generateReport(
  checker: ts.TypeChecker,
  nodedAssertions: NodedAssertion[],
  diagnostics: ts.Diagnostic[],
): Report {
  const failures = [] as Failure[];
  let numSuccesses = 0;

  // Attach errors to nodes; if this isn't possible, then the error was unexpected.
  for (const diagnostic of diagnostics) {
    let { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);

    const nodedAssertion = _.find(nodedAssertions, {assertion: {line}});
    if (nodedAssertion) {
      nodedAssertion.error = diagnostic;
    } else {
      let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      failures.push({
        type: 'UNEXPECTED_ERROR',
        line: line,
        message,
      })
    }
  }

  // Go through and check all the assertions.
  for (const {assertion, type, error} of nodedAssertions) {
    const line = assertion.line;
    if (assertion.kind === 'error') {
      if (!error) {
        failures.push({
          type: 'MISSING_ERROR',
          line,
          message: assertion.pattern
        });
      } else {
        const message = ts.flattenDiagnosticMessageText(error.messageText, '\n');
        if (message.indexOf(assertion.pattern) === -1) {
          failures.push({
            type: 'WRONG_ERROR',
            line,
            expectedMessage: assertion.pattern,
            actualMessage: message,
          });
        } else {
          numSuccesses++;
        }
      }
    } else if (assertion.kind === 'type') {
      const actualType = checker.typeToString(type);
      if (actualType !== assertion.type) {
        failures.push({
          type: 'WRONG_TYPE',
          line,
          expectedType: assertion.type,
          actualType,
        })
      } else {
        numSuccesses++;
      }
    }
  }

  failures.sort((a, b) => a.line - b.line);

  return { numSuccesses, failures };
}