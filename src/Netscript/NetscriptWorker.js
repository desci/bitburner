/* Contains the entire implementation (parser and evaluator) of
 * the Netscript language. It needs to be all in one file because the scripts
 * are evaluated using Web Workers, which runs code from a single file */

 
/* Evaluator
 * 	Evaluates the Abstract Syntax Tree for Netscript
 *  generated by the Parser class
 */
// Evaluator should return a Promise, so that any call to evaluate() can just
//wait for that promise to finish before continuing
function evaluate(exp, workerScript) {
	var env = workerScript.env;
    switch (exp.type) {
		case "num":
		case "str":
		case "bool":
			return new Promise(function(resolve, reject) {
				resolve(exp.value);
			});
			break;
		case "var":
			return new Promise(function(resolve, reject) {
				resolve(env.get(exp.value));
			});
			break;
		//Can currently only assign to "var"s
		case "assign":
			console.log("Evaluating assign operation");
			return new Promise(function(resolve, reject) {
				if (exp.left.type != "var")
					throw new Error("Cannot assign to " + JSON.stringify(exp.left));
				
				var p = new Promise(function(resolve, reject) {
					setTimeout(function() { 
						var expRightPromise = evaluate(exp.right, workerScript);
						expRightPromise.then(function(expRight) {
							resolve(expRight);
						});
					}, CONSTANTS.CodeInstructionRunTime)
				});
				
				p.then(function(expRight) {
					console.log("Right side of assign operation resolved with value: " + expRight);
					env.set(exp.left.value, expRight);
					console.log("Assign operation finished");
					resolve("assignFinished");
				});
			});
			
		case "binary":
			console.log("Binary operation called");
			return new Promise(function(resolve, reject) {
				var pLeft = new Promise(function(resolve, reject) {
					setTimeout(function() {
						var promise = evaluate(exp.left, workerScript);
						promise.then(function(valLeft) {
							resolve(valLeft);
						});
					}, CONSTANTS.CodeInstructionRunTime);
				});
			
				pLeft.then(function(valLeft) {
					var pRight = new Promise(function(resolve, reject) {
						setTimeout(function() {
							var promise = evaluate(exp.right, workerScript);
							promise.then(function(valRight) {
								resolve([valLeft, valRight]);
							});
						}, CONSTANTS.CodeInstructionRunTime);
					});
				
					pRight.then(function(args) {
						console.log("Resolving binary operation");
						resolve(apply_op(exp.operator, args[0], args[1]));
					});
				});
			});
			break;

		//TODO
		case "if":
			var numConds = exp.cond.length;
			var numThens = exp.then.length;
			if (numConds == 0 || numThens == 0 || numConds != numThens) {
				throw new Error ("Number of conds and thens in if structure don't match (or there are none)");
			}
			
			for (var i = 0; i < numConds; i++) {
				var cond = evaluate(exp.cond[i], workerScript);
				if (cond) return evaluate(exp.then[i], workerScript);
			}
			
			//Evaluate else if it exists, snce none of the conditionals
			//were true
			return exp.else ? evaluate(exp.else, workerScript) : false;
				
		case "for":
			return new Promise(function(resolve, reject) {
				console.log("for loop encountered in evaluator");
				var pInit = new Promise(function(resolve, reject) {
					setTimeout(function() {
						var resInit = evaluate(exp.init, workerScript);
						resInit.then(function(foo) {
							resolve(resInit);
						});
					}, CONSTANTS.CodeInstructionRunTime);
				});

				pInit.then(function(expInit) {
					var pForLoop = evaluateFor(exp, workerScript);
					pForLoop.then(function(forLoopRes) {
						resolve("forLoopDone");
					});
				});
			});
			break;
		case "while":
			console.log("Evaluating while loop");
			return new Promise(function(resolve, reject) {
				var pEvaluateWhile = evaluateWhile(exp, workerScript);
				pEvaluateWhile.then(function(whileLoopRes) {
					resolve("whileLoopDone");
				});
			});
			break;
		case "prog":
			return new Promise(function(resolve, reject) {
				var evaluateProgPromise = evaluateProg(exp, workerScript, 0);
				evaluateProgPromise.then(function(res) {
					resolve(res);
				});
			});
			break;

		/* Currently supported function calls:
		 * 		hack()
		 *		sleep(N) - sleep N seconds
		 *		print(x) - Prints a variable or constant
		 *
		 */
		case "call":
			//Define only valid function calls here, like hack() and stuff
			//var func = evaluate(exp.func, env);
			//return func.apply(null, exp.args.map(function(arg){
			//	return evaluate(arg, env);
			//}));
			return new Promise(function(resolve, reject) {
				setTimeout(function() {
					if (exp.func.value == "hack") {
						console.log("Execute hack()");
						resolve("hackExecuted");
					} else if (exp.func.value == "sleep") {
						console.log("Execute sleep()");
						resolve("sleepExecuted");
					} else if (exp.func.value == "print") {
						var p = new Promise(function(resolve, reject) {
							setTimeout(function() {
								var evaluatePromise = evaluate(exp.args[0], workerScript);
								evaluatePromise.then(function(res) {
									resolve(res);
								});
							}, CONSTANTS.CodeInstructionRunTime);
						});
					
						p.then(function(res) {
							post(res.toString());
							console.log("Print call executed");
							resolve("printExecuted");
						});
					}
				}, CONSTANTS.CodeInstructionRunTime);
			});
			break;

		default:
			throw new Error("I don't know how to evaluate " + exp.type);
    }
}

//Evaluate the looping part of a for loop (Initialization block is NOT done in here)
function evaluateFor(exp, workerScript) {
	console.log("evaluateFor() called");
	return new Promise(function(resolve, reject) {
		var pCond = new Promise(function(resolve, reject) {
			setTimeout(function() {
				var evaluatePromise = evaluate(exp.cond, workerScript);
				evaluatePromise.then(function(resCond) {
					console.log("Conditional evaluated to: " + resCond);
					resolve(resCond);
				});
			}, CONSTANTS.CodeInstructionRunTime);
		});
		
		pCond.then(function(resCond) {
			if (resCond) {
				console.log("About to evaluate an iteration of for loop code");
				//Run the for loop code
				var pCode = new Promise(function(resolve, reject) {
					setTimeout(function() {
						var evaluatePromise = evaluate(exp.code, workerScript);
						evaluatePromise.then(function(resCode) {
							console.log("Evaluated an iteration of for loop code");
							resolve(resCode);
						});
					}, CONSTANTS.CodeInstructionRunTime);
				});
				
				//After the code executes make a recursive call
				pCode.then(function(resCode) {
					var pPostLoop = new Promise(function(resolve, reject) {
						setTimeout(function() {
							var evaluatePromise = evaluate(exp.postloop, workerScript);
							evaluatePromise.then(function(foo) {
								console.log("Evaluated for loop postloop");
								resolve("postLoopFinished");
							});
						}, CONSTANTS.CodeInstructionRunTime);
					});
					
					pPostLoop.then(function(resPostloop) {
						var recursiveCall = evaluateFor(exp, workerScript);
						recursiveCall.then(function(foo) {
							resolve("endForLoop");
						});
					});

				});
			} else {
				console.log("Cond is false, stopping for loop");
				resolve("endForLoop");	//Doesn't need to resolve to any particular value
			}
		});
	});
}

function evaluateWhile(exp, workerScript) {
	console.log("evaluateWhile() called");
	return new Promise(function(resolve, reject) {
		var pCond = new Promise(function(resolve, reject) {
			setTimeout(function() {
				var evaluatePromise = evaluate(exp.cond, workerScript);
				evaluatePromise.then(function(resCond) {
					console.log("Conditional evaluated to: " + resCond);
					resolve(resCond);
				});
			}, CONSTANTS.CodeInstructionRunTime);
		});
		
		pCond.then(function(resCond) {
			if (resCond) {
				//Run the while loop code
				var pCode = new Promise(function(resolve, reject) {
					setTimeout(function() {
						var evaluatePromise = evaluate(exp.code, workerScript);
						evaluatePromise.then(function(resCode) {
							console.log("Evaluated an iteration of while loop code");
							resolve(resCode);
						});
					}, CONSTANTS.CodeInstructionRunTime);
				});
				
				//After the code executes make a recursive call
				pCode.then(function(resCode) {
					var recursiveCall = evaluateWhile(exp, workerScript);
					recursiveCall.then(function(foo) {
						resolve("endWhileLoop");
					});
				});
			} else {
				console.log("Cond is false, stopping while loop");
				resolve("endWhileLoop");	//Doesn't need to resolve to any particular value
			}
		});
	});
}

function evaluateProg(exp, workerScript, index) {
	console.log("evaluateProg() called");
	return new Promise(function(resolve, reject) {
		if (index >= exp.prog.length) {
			console.log("Prog done. Resolving recursively");
			resolve("progFinished");
		} else {
			//Evaluate this line of code in the prog
			var code = new Promise(function(resolve, reject) {
				setTimeout(function() {
					var evaluatePromise = evaluate(exp.prog[index], workerScript); 
					evaluatePromise.then(function(evalRes) {
						resolve(evalRes);
					});
				}, CONSTANTS.CodeInstructionRunTime);
			});
			
			//After the code finishes evaluating, evaluate the next line recursively
			code.then(function(codeRes) {
				var nextLine = evaluateProg(exp, workerScript, index + 1);
				nextLine.then(function(nextLineRes) {
					resolve("progDone");
				});
			});
		}
	});
}

function apply_op(op, a, b) {
    function num(x) {
        if (typeof x != "number")
            throw new Error("Expected number but got " + x);
        return x;
    }
    function div(x) {
        if (num(x) == 0)
            throw new Error("Divide by zero");
        return x;
    }
    switch (op) {
      case "+": return num(a) + num(b);
      case "-": return num(a) - num(b);
      case "*": return num(a) * num(b);
      case "/": return num(a) / div(b);
      case "%": return num(a) % div(b);
      case "&&": return a !== false && b;
      case "||": return a !== false ? a : b;
      case "<": return num(a) < num(b);
      case ">": return num(a) > num(b);
      case "<=": return num(a) <= num(b);
      case ">=": return num(a) >= num(b);
      case "==": return a === b;
      case "!=": return a !== b;
    }
    throw new Error("Can't apply operator " + op);
} 
 
 
 
/* Environment
 * 	NetScript program environment 
 */
function Environment(parent) {
    this.vars = Object.create(parent ? parent.vars : null);
    this.parent = parent;
}
Environment.prototype = {
	//Create a "subscope", which is a new new "sub-environment"
	//The subscope is linked to this through its parent variable
    extend: function() {
        return new Environment(this);
    },
	
	//Finds the scope where the variable with the given name is defined
    lookup: function(name) {
        var scope = this;
        while (scope) {
            if (Object.prototype.hasOwnProperty.call(scope.vars, name))
                return scope;
            scope = scope.parent;
        }
    },
	
	//Get the current value of a variable
    get: function(name) {
        if (name in this.vars)
            return this.vars[name];
        throw new Error("Undefined variable " + name);
    },
	
	//Sets the value of a variable in any scope
    set: function(name, value) {
        var scope = this.lookup(name);
        // let's not allow defining globals from a nested environment
		//
		// If scope is null (aka existing variable with name could not be found)
		// and this is NOT the global scope, throw error
        if (!scope && this.parent)
            throw new Error("Undefined variable " + name);
        return (scope || this).vars[name] = value;
    },
	
	//Creates (or overwrites) a variable in the current scope
    def: function(name, value) {
        return this.vars[name] = value;
    }
};
 
 
 
 
/* Parser
 *  Creates Abstract Syntax Tree Nodes
 * Operates on a stream of tokens from the Tokenizer 
 */ 
 
var FALSE = {type: "bool", value: false};

function Parser(input) {
    var PRECEDENCE = {
        "=": 1,
        "||": 2,
        "&&": 3,
        "<": 7, ">": 7, "<=": 7, ">=": 7, "==": 7, "!=": 7,
        "+": 10, "-": 10,
        "*": 20, "/": 20, "%": 20,
    };
    return parse_toplevel();
	
	//Returns true if the next token is a punc type with value ch
    function is_punc(ch) {
        var tok = input.peek();
        return tok && tok.type == "punc" && (!ch || tok.value == ch) && tok;
    }
	
	//Returns true if the next token is the kw keyword
    function is_kw(kw) {
        var tok = input.peek();
        return tok && tok.type == "kw" && (!kw || tok.value == kw) && tok;
    }
	
	//Returns true if the next token is an op type with the given op value
    function is_op(op) {
        var tok = input.peek();
        return tok && tok.type == "op" && (!op || tok.value == op) && tok;
    }
	
	//Checks that the next character is the given punctuation character and throws
	//an error if it's not. If it is, skips over it in the input
    function checkPuncAndSkip(ch) {
        if (is_punc(ch)) input.next();
        else input.croak("Expecting punctuation: \"" + ch + "\"");
    }
	
	//Checks that the next character is the given keyword and throws an error
	//if its not. If it is, skips over it in the input
    function checkKeywordAndSkip(kw) {
        if (is_kw(kw)) input.next();
        else input.croak("Expecting keyword: \"" + kw + "\"");
    }
	
	//Checks that the next character is the given operator and throws an error
	//if its not. If it is, skips over it in the input
    function checkOpAndSkip(op) {
        if (is_op(op)) input.next();
        else input.croak("Expecting operator: \"" + op + "\"");
    }
	
    function unexpected() {
        input.croak("Unexpected token: " + JSON.stringify(input.peek()));
    }
	
    function maybe_binary(left, my_prec) {
        var tok = is_op();
        if (tok) {
            var his_prec = PRECEDENCE[tok.value];
            if (his_prec > my_prec) {
                input.next();
                return maybe_binary({
                    type     : tok.value == "=" ? "assign" : "binary",
                    operator : tok.value,
                    left     : left,
                    right    : maybe_binary(parse_atom(), his_prec)
                }, my_prec);
            }
        }
        return left;
    }
	
    function delimited(start, stop, separator, parser) {
        var a = [], first = true;
        checkPuncAndSkip(start);
        while (!input.eof()) {
            if (is_punc(stop)) break;
            if (first) first = false; else checkPuncAndSkip(separator);
            if (is_punc(stop)) break;
            a.push(parser());
        }
        checkPuncAndSkip(stop);
        return a;
    }
	
    function parse_call(func) {
        return {
            type: "call",
            func: func,
            args: delimited("(", ")", ",", parse_expression),
        };
    }
	
    function parse_varname() {
        var name = input.next();
        if (name.type != "var") input.croak("Expecting variable name");
        return name.value;
    }
	
	/* type: "if",
	 * cond: [ {"type": "var", "value": "cond1"}, {"type": "var", "value": "cond2"}...]
	 * then: [ {"type": "var", "value": "then1"}, {"type": "var", "value": "then2"}...]
	 * else: {"type": "var", "value": "foo"}
	 */
    function parse_if() {
		console.log("Parsing if token");
        checkKeywordAndSkip("if");
		
		//Conditional
        var cond = parse_expression();
		
		//Body
        var then = parse_expression();
        var ret = {
            type: "if",
            cond: [],
            then: [],
        };
		ret.cond.push(cond);
		ret.then.push(then);
		
		// Parse all elif branches
		while (is_kw("elif")) {
			input.next();
			var cond = parse_expression();
			var then = parse_expression();
			ret.cond.push(cond);
			ret.then.push(then);
		}
		
		// Parse else branch, if it exists
        if (is_kw("else")) {
            input.next();
            ret.else = parse_expression();
        }
		
        return ret;
    }
	
	/* for (init, cond, postloop) {code;}
	 *
	 * type: "for",
	 * init: assign node,
	 * cond: var node,
	 * postloop: assign node
	 * code: prog node
	 */
	function parse_for() {
		console.log("Parsing for token");
		checkKeywordAndSkip("for");

		splitExpressions = delimited("(", ")", ";", parse_expression);
		console.log("Parsing code in for loop");
		code = parse_expression();
		
		if (splitExpressions.length != 3) {
			throw new Error("for statement has incorrect number of arugments");
		}
		
		//TODO Check type of the init, cond, and postloop nodes 
		return {
			type: "for",
			init: splitExpressions[0],
			cond: splitExpressions[1],
			postloop: splitExpressions[2],
			code: code
		}
	}
	
	/* while (cond) {}
	 * 
	 * type: "while",
	 * cond: var node
	 * code: prog node
	 */
	function parse_while() {
		console.log("Parsing while token");
		checkKeywordAndSkip("while");
		
		var cond = parse_expression();
		var code = parse_expression();
		return {
			type: "while",
			cond: cond,
			code: code
		}
		
	}
	
    function parse_bool() {
        return {
            type  : "bool",
            value : input.next().value == "true"
        };
    }
	
    function maybe_call(expr) {
        expr = expr();
        return is_punc("(") ? parse_call(expr) : expr;
    }
	
    function parse_atom() {
        return maybe_call(function(){
            if (is_punc("(")) {
                input.next();
                var exp = parse_expression();
                checkPuncAndSkip(")");
                return exp;
            }
            if (is_punc("{")) return parse_prog();
            if (is_kw("if")) return parse_if();
			if (is_kw("for")) return parse_for();
			if (is_kw("while")) return parse_while();
			//Note, let for loops be function calls (call node types)
            if (is_kw("true") || is_kw("false")) return parse_bool();

            var tok = input.next();
            if (tok.type == "var" || tok.type == "num" || tok.type == "str")
                return tok;
            unexpected();
        });
    }
	
    function parse_toplevel() {
        var prog = [];
        while (!input.eof()) {
            prog.push(parse_expression());
            if (!input.eof()) checkPuncAndSkip(";");
        }
		//Return the top level Abstract Syntax Tree, where the top node is a "prog" node
        return { type: "prog", prog: prog };
    }
	
    function parse_prog() {
		console.log("Parsing prog token");
        var prog = delimited("{", "}", ";", parse_expression);
        if (prog.length == 0) return FALSE;
        if (prog.length == 1) return prog[0];
        return { type: "prog", prog: prog };
    }
	
    function parse_expression() {
        return maybe_call(function(){
            return maybe_binary(parse_atom(), 0);
        });
    }
}
 
 
 /* Tokenizer 
 * Acts on top of the InputStream class. Takes in a character input stream and and parses it into tokens.
 * Tokens can be accessed with peek() and next().
 *
 *  Token types:
 *      {type: "punc", value: "(" }           	// punctuation: parens, comma, semicolon etc.
 *      {type: "num", value: 5 }              	// numbers (including floats)
 *      {type: "str", value: "Hello World!" } 	// strings
 *      {type: "kw", value: "for/if/" }        	// keywords, see defs below
 *      {type: "var", value: "a" }            	// identifiers/variables
 *      {type: "op", value: "!=" }            	// operator characters
 *		{type: "bool", value: "true" } 			// Booleans
 *
 */
 
function Tokenizer(input) {
    var current = null;
    var keywords = " if elif else true false while for ";
    
    return {
        next    : next,
        peek    : peek,
        eof     : eof,
        croak   : input.croak
    }
    
    function is_keyword(x) {
        return keywords.indexOf(" " + x + " ") >= 0;
    }
    
    function is_digit(ch) {
        return /[0-9]/i.test(ch);
    }
    
    //An identifier can start with any letter or an underscore
    function is_id_start(ch) {
        return /[a-z_]/i.test(ch);
    }
    
    function is_id(ch) {
        return is_id_start(ch) || "?!-<>=0123456789".indexOf(ch) >= 0;
    }
    
    function is_op_char(ch) {
        return "+-*/%=&|<>!".indexOf(ch) >= 0;
    }
    
    function is_punc(ch) {
        return ",;(){}[]".indexOf(ch) >= 0;
    }
    
    function is_whitespace(ch) {
        return " \t\n".indexOf(ch) >= 0;
    }
    
    function read_while(predicate) {
        var str = "";
        while (!input.eof() && predicate(input.peek()))
            str += input.next();
        return str;
    }
    
    function read_number() {
        var has_dot = false;
        //Reads the number from the input. Checks for only a single decimal point
        var number = read_while(function(ch){
            if (ch == ".") {
                if (has_dot) return false;
                has_dot = true;
                return true;
            }
            return is_digit(ch);
        });
        return { type: "num", value: parseFloat(number) };
    }
    
    //This function also checks the identifier against a list of known keywords (defined at the top)
    //and will return a kw object rather than identifier if it is one
    function read_ident() {
        //Identifier must start with a letter or underscore..and can contain anything from ?!-<>=0123456789
        var id = read_while(is_id);
        return {
            type  : is_keyword(id) ? "kw" : "var",
            value : id
        };
    }
    
    function read_escaped(end) {
        var escaped = false, str = "";
        input.next();   //Skip the quotation mark
        while (!input.eof()) {
            var ch = input.next();
            if (escaped) {
                str += ch;
                escaped = false;
            } else if (ch == "\\") {
                escaped = true;
            } else if (ch == end) {
                break;
            } else {
                str += ch;
            }
        }
        return str;
    }
    
    function read_string(ch) {
        if (ch == '"') {
            return { type: "str", value: read_escaped('"') };
        } else if (ch == '\'') {
            return { type: "str", value: read_escaped('\'') };
        }
    }
    
    //Only supports single-line comments right now
    function skip_comment() {
        read_while(function(ch){ return ch != "\n" });
        input.next();
    }
    
    //Gets the next token
    function read_next() {
        //Skip over whitespace
        read_while(is_whitespace);
        
        if (input.eof()) return null;
        
        //Peek the next character and decide what to do based on what that
        //next character is
        var ch = input.peek();
        
        if (ch == "//") {
            skip_comment();
            return read_next();
        }
        
        if (ch == '"' || ch == '\'')          return read_string(ch);
        if (is_digit(ch))       return read_number();
        if (is_id_start(ch))    return read_ident();    
        if (is_punc(ch)) return {
            type    : "punc",
            value   : input.next()
        }
        if (is_op_char(ch)) return {
            type    : "op",
            value   : read_while(is_op_char)
        }
        
    }
    
    function peek() {
        //Returns current token, unless its null in which case it grabs the next one
        //and returns it
        return current || (current = read_next());
    }
    
    function next() {
        //The token might have been peaked already, in which case read_next() was already
        //called so just return current
        var tok = current;
        current = null;
        return tok || read_next();
    }
    
    function eof() {
        return peek() == null;
    }
}

 
/* InputStream class. Creates a "stream object" that provides operations to read
* from a string. */
function InputStream(input) {
    var pos = 0, line = 1, col = 0;
    return {
        next  : next,
        peek  : peek,
        eof   : eof,
        croak : croak,
    };
    function next() {
        var ch = input.charAt(pos++);
        if (ch == "\n") line++, col = 0; else col++;
        return ch;
    }
    function peek() {
        return input.charAt(pos);
    }
    function eof() {
        return peek() == "";
    }
    function croak(msg) {
        throw new Error(msg + " (" + line + ":" + col + ")");
    }
}

/* Actual Worker Code */
function WorkerScript() {
	this.name 		= "";
	this.running 	= false;
	this.server 	= null;
	this.code 		= "";
	this.env 		= new Environment();
	this.timeout	= null;
}

var workerScripts 			= [];

//Loop through workerScripts and run every script that is not currently running
function runScriptsLoop() {
	for (var i = 0; i < workerScripts.length; i++) {
		if (workerScripts[i].running == false) {
			var ast = Parser(Tokenizer(InputStream(workerScripts[i].code)));
			
			console.log("Starting new script: " + workerScripts[i].name);
			console.log("AST of new script:");
			console.log(ast);
			
			evaluate(ast, workerScripts[i]);
			workerScripts[i].running = true;
		}
	}
	
	setTimeout(runScriptsLoop, 10000);
}

runScriptsLoop();