## TurboWarp/scratch-vm

Modified Scratch VM with a JIT compiler and more features.

The public API of TurboWarp/scratch-vm should be compatible with LLK/scratch-vm. See "Public API" section below for more information.

## Setup

See https://github.com/TurboWarp/scratch-gui/wiki/Getting-Started to setup the complete TurboWarp environment.

If you just want to play with the VM then it's the same process as upstream scratch-vm.

## Public API

Any public-facing API in LLK/scratch-vm *should* work just fine in TurboWarp/scratch-vm. Anything that doesn't is a bug. TurboWarp adds some new methods to the public API.

### Runtime.setFramerate / VirtualMachine.setFramerate

setCompatibilityMode is deprecated (but still works) in favor of a generic setFramerate method.

```js
runtime.setFramerate(60);
```

There is an event for framerate changes on Runtime and VirtualMachine: FRAMERATE_CHANGED (emitted with new framerate as only argument)

### Runtime.setInterpolation / VirtualMachine.setInterpolation

Toggles frame interpolation, an experimental feature that tries to make project motion smoother without changing the script tick rate.

There is an event for changes on Runtime and VirtualMachine: INTERPOLATION_CHANGED

### Runtime.setCompilerOptions / VirtualMachine.setCompilerOptions

This lets you change the behavior of the compiler. This method takes an object with the following arguments:

 - enabled (boolean; default true) - controls whether the JIT compiler is enabled
 - warpTimer (boolean; default false) - controls whether to use a warp timer to limit how long warp scripts can run. Can have significant performance impact

```js
runtime.setCompilerOptions({
  enabled: true,
  warpTimer: true
});
// Partial updates are also supported -- this will only change `enabled` and not any other properties
runtime.setCompilerOptions({ enabled: false });
```

There is an event for compiler option changes on Runtime and VirtualMachine: COMPILER_OPTIONS_CHANGED (called with current options)

### Runtime.setRuntimeOptions / VirtualMachine.setRuntimeOptions

Similar to setCompilerOption. This lets you control some behavior of the runtime.

 - maxClones (number; default 300) - controls the clone limit; Infinity to disable

There is an event for runtime option changes on Runtime and VirtualMachine: RUNTIME_OPTIONS_CHANGED (called with current options)

### Runtime.stop / VirtualMachine.stop

Stops the tick loop. This does not touch the active thread list. Anything currently active will be resumed when start is called again.

There is an event for stop on Runtime and VirtualMachine: RUNTIME_STOPPED (similar to RUNTIME_STARTED)

### Runtime.stageWidth / Runtime.stageHeight

These control the width and height of the stage. Set them to values other than 480 and 360 respectively to get custom stage sizes. Keep in mind that you need to manually resize the renderer as well.

### COMPILE_ERROR event

A COMPILE_ERROR is fired on Runtime and VirtualMachine when a script couldn't be compiled.

## Extension authors

If you only use the standard reporter, boolean, and command block types, everything should just work without any changes.

## Compiler Overview

The source code for the compiler is in src/compiler. Script compilation happens "Just In Time" when a thread is started.

I'm going to try to explain some of the high-level details of the compiler below. If you have any questions, just ask. Open an issue or something, I'm very easy to get ahold of.

### Intermediate representation

Source: src/compiler/irgen.js

The first stage of the compiler is to generate an intermediate representation (IR). This is really just a more abstract version of Scratch's AST. Some analysis and optimizations happen at this stage.

In the future there may also be multiple different code generators, and having this abstraction will be even more useful then.

### JavaScript generation

Source: src/compiler/jsgen.js

The IR is passed into the JavaScript generator which descends the IR and generates optimized JavaScript. This JavaScript has some idiosyncrasies. I'll try to explain some of them using a simple project with a bouncing cat (https://scratch.mit.edu/projects/437419376) as an example.

This is an example result of compiling a project.

```js
function factory0 (target) {
  // Note: manually formatted to be more readable. The actual code has no indentation or other formatting.
  const runtime = target.runtime;
  const stage = runtime.getTargetForStage();

  const b0 = stage.variables["`jEk@4|i[#Fk?(8x)AV.-my variable"];

  return function* gen0 () {
    b0.value = 0;
    target.setXY(0, 0);

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

The factory function is the function that the JavaScript generator returns. This is run once when a thread is started. This function takes the current target as an argument, sets up any required variables, and returns another function (keep reading). There is also an implied `thread` variable that represents the current thread.

#### Factory variables

The factory function sets up various pieces of data that the script needs to run. For example, every script gets access to the `runtime` and `stage` objects. These variables will be shared amongst all instances of the generator function returned by the factory function (described below).

#### Generator function

The factory function returns a generator function. When a script is run, this is the code that runs. If a procedure runs 20 times, this script runs 20 times. If a procedure never runs, this function is never run.

This function is usually a [generator function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*). The interesting thing about generator functions is that they can yield at arbitrary points and resume later, which is necessary to support control flow used by Scratch.

#### The actual script

Let's break this down line-by-line.

`b0.value = 0;`

Sets the `value` property of `b0` (a factory variable) to 0. This is where variable values are stored.

`target.setXY(0, 0)`

Sets the target's position to (0, 0).

`for (var a0 = 100; a0 >= 0.5; a0--) {`

This is really just a regular for loop that will repeat 100 times. The loop index, `a0`, is called a local variable. These are variables that are local to each invocation of the generator function. In this case, it's being used as a loop index to iterate 100 times.

`b0.value = ((+b0.value || 0) + 1);`

Changes `b0.value` by 1. `(+b0.value || 0)` converts the value of `b0.value` to a number (in Scratch, NaN becomes 0). This is necessary because the compiler can't statically determine that `b0.value` will always evaluate to a number. Why can't it, even when `b0.value` was just set to the number 0 earlier? Because the script may have yielded control and another script may have changed the type of the variable, as you'll see later. If the variable changes to the string "10" and the script does not perform this conversion, then you would get `"10" + 1` which evaluates to the string "101", not the number 11.

`runtime.ext_scratch3_motion._moveSteps(b0.value, target);`

Accesses the `scratch3_motion` extension through the runtime factory variable and calls `_moveSteps` with `b0.value` (distance to move) and `target` (the target to operate on).

`runtime.ext_scratch3_motion._ifOnEdgeBounce(target);`

Similar to the above, it runs the "if on edge, bounce" block on the current target.

`if (thread.warp === 0) yield;`

This is what makes JavaScript generator functions powerful: they can yield and resume later. This particular expression says "if not running in warp mode (run without screen refresh), then yield and let another script run."

`retire();`

This runs the runtime function `retire`. This function marks the current thread as finished so that it will not run again. There are many other runtime functions for lots of operations such as list replacements, insertions, gets, etc. These are defined in src/compiler/jsexecute.js

#### Procedures

One factory function exists for each procedure used by a thread. These work the same as described above: factory function runs once, generator functions run as needed. The only difference is that generator functions for procedures accepts arguments and can be called.

#### Compatibility layer

Not every block needs to be compiled to optimized JavaScript. For example, will anyone notice if the "play sound until done" block runs slightly slower than it could? Probably not. Would people notice if there was a subtle bug that broke 1 in 10 sounds? Definitely. This is why the compiler also has a "compatibility layer" that allows it to use the Scratch implementation of blocks rather than writing a second "compiled" version.

For example, an addition in TurboWarp is compiled down to the JavaScript `+` operator: `firstThing + secondThing`. If the `+` operator instead ran in the compatibility layer, it would look like: `yield* executeInCompatibilityLayer({"OPERAND1":firstThing,"OPERAND2":secondThing}, runtime.getOpcodeFunction("operator_add"))` and the actual addition would happen in Scratch's definition of the operator_add block.

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
