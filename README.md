## TurboWarp/scratch-vm

JIT compiler for Scratch projects.

TurboWarp/scratch-vm is API-compatible(ish) with LLK/scratch-vm -- it should be a drop-in replacement. Any API incompatibilities are bugs and should be reported.

## Setup

See https://github.com/TurboWarp/scratch-gui/wiki/Getting-Started to setup the complete TurboWarp environment.

If you just want to play with the VM then it's the same process as upstream scratch-vm.

## Non-goals

 - upstreaming
 - generating code to be easily read or modified by humans
 - 100% compatibility with every script, block, extension
 - allow modifying compiled scripts while they are running

## Extension authors

The easiest way to make your extension compatible with TurboWarp is to use the same process as standard Scratch (https://github.com/LLK/scratch-vm/blob/develop/docs/extensions.md) to add your extension, and then add your opcodes to src/compiler/compat-blocks.js to make them run in the compatibility layer (described in more detail below). Stacked blocks (things that don't report a value such as "move ( ) steps") go in the `stacked` list and inputs (things that report a value such as multiplication, getting a variable, getting a line of a list, etc.) go in the `inputs` list. Your opcodes are probably in the format `extensionId_methodName`.

## Compiler Overview

The source code for the compiler is in src/compiler. Script compilation happens "Just In Time" when a thread is started.

I'm going to try to explain some of the high-level details of the compiler below. If you have any questions, just ask. Open an issue or something, I'm very easy to get ahold of.

### Abstract syntax tree

Source: src/compiler/astgen.js

The first stage of the compiler is to generate an AST. This is not the same as the AST that the Scratch VM maintains internally. The goal of this stage is to abstract the exact details of the project into something that can be more easily parsed. Some analysis and optimizations happen at this stage. The required procedures are recursed as well.

### JavaScript generation

Source: src/compiler/jsgen.js

The AST is passed into the JavaScript generator which descends the AST and generates optimized JavaScript. This JavaScript has some idiosyncrasies. I'll try to explain some of them using a simple project with a bouncing cat (https://scratch.mit.edu/projects/437419376) as an example.

This is an example result of compiling a project.

```js
function factory0 (target) {
  // Note: manually formatted to be more readable. The actual code has no indentation or other formatting.
  const runtime = target.runtime;
  const stage = runtime.getTargetForStage();

  const b0 = stage.variables["`jEk@4|i[#Fk?(8x)AV.-my variable"];

  return function* gen0 () {
    b0.value = 0;

    for (var a0 = 100; a0 >= 0.5; a0--) {
      b0.value = ((+b0.value || 0) + 1);
      runtime.ext_scratch3_motion._moveSteps(b0.value, target);
      runtime.ext_scratch3_motion._ifOnEdgeBounce(target);

      if (thread.warp === 0) yield;
    }

    retire();
  };
}
```

There's a lot to unpack here, so let's start from the top.

#### Factory function

The factory function is the function that the JavaScript generator returns. This is run once when a thread is started. This function takes the current target as an argument, sets up any required variables, and returns another function. We'll discuss that function later. There is also an implied `thread` variable within scope that represents the current thread.

The factory function is given a name like `factory0`, `factory1`, etc. for debugging purposes.

#### Factory variables

The factory function sets up various pieces of data that the script needs to run. For example, every script gets access to the `runtime` and `stage` objects. Every invocation of the function shares the same factory variables, which is important in the case of procedures.

Each variable that the script needs to access is set up in a factory variable. By referencing variables using their ID one time at thread start, major performance improvements have been measured. Each of these automatically generated variables gets a name like `b0`, `b1`, etc. In this case, `b0` is referencing a global variable (ie. on the stage) called `my variable`.

#### Generator function

The factory function returns a generator function. When a script is run, this is the code that is run. If a procedure runs 20 times, this script runs 20 times. If a procedure never runs, this function is never run. All the script logic is here. Of course, it uses the factory variables set up previously.

Usually, this function is a generator function (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*), but it isn't always. The interesting thing about generator functions is that they can yield at arbitrary points and resume later, which is something that Scratch projects do all the time.

The generator function is given a name like `gen0`, `gen1`, `fun2`, `gen3_procedure_name`, or `fun4_procedure_name` depending on the context for debugging. The `gen` or `fun` denotes the type of function.

#### The actual script

Let's break this down line-by-line.

`b0.value = 0;`

Sets `b0.value` (a factory variable setup earlier that references ```stage.variables["`jEk@4|i[#Fk?(8x)AV.-my variable"]```, a variable) to 0. Note that this is the number 0, not the string "0". The compiler tries to convert strings to numbers when it is safe to do so (more complicated than it sounds).

`for (var a0 = 100; a0 >= 0.5; a0--) {`

This begins a "repeat 100" loop. `a0` is called a local variable. Each local variable gets a name like `a0`, `a1`, etc. These are variables that are local to each invocation of the generator function. In this case, it's being used as a loop index to iterate 100 times. The for loop is written in a weird way that ensures compatibility with Scratch.

`b0.value = ((+b0.value || 0) + 1);`

Changes `b0.value` by 1. The strange `(+b0.value || 0)` converts the value of `b0.value` to a number using the same rules as Scratch where NaN becomes 0. This is necessary because the compiler can't statically determine that `b0.value` will always evaluate to a number. Why can't it, even when `b0.value` was *just* set to the *number* 0 earlier? Because the script may have yielded control and another script may have changed the type of the variable, as you'll see later. If the variable changes to the string "10" and the script does not perform this conversion, then you would get `"10" + 1` which evaluates to the string "101", not the number 11.

`runtime.ext_scratch3_motion._moveSteps(b0.value, target);`

Accesses the scratch3_motion extension (even the builtin Scratch blocks are implemented as "extensions") and calls _moveSteps with `b0.value` (distance to move) and `target` (the target to operate on).

`runtime.ext_scratch3_motion._ifOnEdgeBounce(target);`

Similar to the above, it runs the "if on edge, bounce" block on the current target.

`if (thread.warp === 0) yield;`

This is the cool thing about generator functions: they can yield control and resume later. "Warp" is the internal name given to "Run without screen refresh." This particular expression says "if not running in warp mode (run without screen refresh), then yield". This will allow another script to run. If scripts were not generator functions, then this script, which should result in a smooth animation, would instead result in an instantaneous movement. `thread.warp` is a number where 0 indicates that the current thread is not in warp mode.

`}`

Go back to the for loop.

`retire();`

This runs the runtime function `retire`. This function marks the current thread as finished so that it will not run again. There are many other runtime functions for lots of operations such as list replacements, insertions, gets, etc. These are defined in src/compiler/execute.js

#### Procedures

One factory function exists for each procedure used by a thread. These work the same as described above: factory function runs once, factory variables are set up, generator functions run as needed. The only difference is that the generator function accepts arguments given names like `p0`, `p1`, etc. Procedures are called with `yield* thread.procedures["procedureCode"]()` or `thread.procedures["procedureCode"]()`, depending on what optimizations can be made.

#### Compatibility layer

Not every block can or needs to be compiled. For example, will people *really* notice if the "play sound until done" block runs slightly slower than it could? Probably not. Would people notice if the block was broken half of the time? Definitely. This is why the compiler also has a "compatibility layer" that allows it to run blocks directly from Scratch without "compiling" them.

For example, an addition in TurboWarp is compiled down to the JavaScript `+` operator: `firstThing + secondThing`. If the `+` operator instead ran in the compatibility layer, it would look like: `yield* executeInCompatibilityLayer({"OPERAND1":firstThing,"OPERAND2":secondThing}, runtime.getOpcodeFunction("operator_add"))`

This is slower, of course, but for complex blocks (eg. motion_glidesecstoxy), extension blocks (eg. videoSensing_videoToggle), and non-critical blocks (eg. sound_play), this is significantly easier and less prone to bugs.

The opcodes that this is used for are in src/engine/compat-blocks.js

#### Errors

When scripts can't be compiled, they run in the standard (slow) scratch-vm interpreter. This is used for some edge cases: monitor threads, unknown opcodes, edge-activated hats, other errors.

<!--

## scratch-vm
#### Scratch VM is a library for representing, running, and maintaining the state of computer programs written using [Scratch Blocks](https://github.com/LLK/scratch-blocks).

[![Build Status](https://travis-ci.org/LLK/scratch-vm.svg?branch=develop)](https://travis-ci.org/LLK/scratch-vm)
[![Coverage Status](https://coveralls.io/repos/github/LLK/scratch-vm/badge.svg?branch=develop)](https://coveralls.io/github/LLK/scratch-vm?branch=develop)
[![Greenkeeper badge](https://badges.greenkeeper.io/LLK/scratch-vm.svg)](https://greenkeeper.io/)

## Installation
This requires you to have Git and Node.js installed.

To install as a dependency for your own application:
```bash
npm install scratch-vm
```
To set up a development environment to edit scratch-vm yourself:
```bash
git clone https://github.com/LLK/scratch-vm.git
cd scratch-vm
npm install
```

## Development Server
This requires Node.js to be installed.

For convenience, we've included a development server with the VM. This is sometimes useful when running in an environment that's loading remote resources (e.g., SVGs from the Scratch server). If you would like to use your modified VM with the full Scratch 3.0 GUI, [follow the instructions to link the VM to the GUI](https://github.com/LLK/scratch-gui/wiki/Getting-Started).

## Running the Development Server
Open a Command Prompt or Terminal in the repository and run:
```bash
npm start
```

## Playground
To view the Playground, make sure the dev server's running and go to [http://localhost:8073/playground/](http://localhost:8073/playground/) - you will be directed to the playground, which demonstrates various tools and internal state.

![VM Playground Screenshot](https://i.imgur.com/nOCNqEc.gif)


## Standalone Build
```bash
npm run build
```

```html
<script src="/path/to/dist/web/scratch-vm.js"></script>
<script>
    var vm = new window.VirtualMachine();
    // do things
</script>
```

## How to include in a Node.js App
For an extended setup example, check out the /src/playground directory, which includes a fully running VM instance.
```js
var VirtualMachine = require('scratch-vm');
var vm = new VirtualMachine();

// Block events
Scratch.workspace.addChangeListener(vm.blockListener);

// Run threads
vm.start();
```

## Abstract Syntax Tree

#### Overview
The Virtual Machine constructs and maintains the state of an [Abstract Syntax Tree](https://en.wikipedia.org/wiki/Abstract_syntax_tree) (AST) by listening to events emitted by the [scratch-blocks](https://github.com/LLK/scratch-blocks) workspace via the `blockListener`. Each target (code-running object, for example, a sprite) keeps an AST for its blocks. At any time, the current state of an AST can be viewed by inspecting the `vm.runtime.targets[...].blocks` object.

#### Anatomy of a Block
The VM's block representation contains all the important information for execution and storage. Here's an example representing the "when key pressed" script on a workspace:
```json
{
  "_blocks": {
    "Q]PK~yJ@BTV8Y~FfISeo": {
      "id": "Q]PK~yJ@BTV8Y~FfISeo",
      "opcode": "event_whenkeypressed",
      "inputs": {
      },
      "fields": {
        "KEY_OPTION": {
          "name": "KEY_OPTION",
          "value": "space"
        }
      },
      "next": null,
      "topLevel": true,
      "parent": null,
      "shadow": false,
      "x": -69.333333333333,
      "y": 174
    }
  },
  "_scripts": [
    "Q]PK~yJ@BTV8Y~FfISeo"
  ]
}
```

## Testing
```bash
npm test
```

```bash
npm run coverage
```

## Publishing to GitHub Pages
```bash
npm run deploy
```

This will push the currently built playground to the gh-pages branch of the
currently tracked remote.  If you would like to change where to push to, add
a repo url argument:
```bash
npm run deploy -- -r <your repo url>
```

## Donate
We provide [Scratch](https://scratch.mit.edu) free of charge, and want to keep it that way! Please consider making a [donation](https://secure.donationpay.org/scratchfoundation/) to support our continued engineering, design, community, and resource development efforts. Donations of any size are appreciated. Thank you!

-->
