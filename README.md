# dawikk-scan

A React Native library that integrates the powerful Scan draughts (checkers) engine for both iOS and Android platforms.

## Features

- Full HUB protocol support for draughts engines
- Native integration with Scan draughts engine
- Cross-platform support (iOS and Android)
- Simple event-based API for communication with the engine
- Bundled with the latest Scan engine (version 3.1)
- Performance optimized for mobile devices
- Configurable event throttling to prevent UI thread blocking
- Selectable event emission to improve performance
- Support for multiple draughts variants (Normal, Killer, BT, Frisian, Losing)
- Enhanced performance with latest analysis always available

## Installation

```sh
# Using npm
npm install dawikk-scan --save

# Or using Yarn
yarn add dawikk-scan
```

### iOS Setup

```sh
cd ios && pod install
```

## Basic Usage

```javascript
import Scan from 'dawikk-scan';

// Configure the engine (optional)
Scan.setConfig({
  throttling: {
    analysisInterval: 200, // Emit analysis events every 200ms
    messageInterval: 300   // Emit raw messages every 300ms
  },
  events: {
    emitMessage: true,     // Enable/disable raw message events
    emitAnalysis: true,    // Enable/disable analysis events
    emitBestMove: true     // Enable/disable bestmove events
  }
});

// Initialize the engine
await Scan.init();

// Set up a listener for engine output
const unsubscribeMessage = Scan.addMessageListener((message) => {
  console.log('Engine message:', message);
});

// Send HUB commands
await Scan.sendCommand('hub');
await Scan.sendCommand('init');
await Scan.sendCommand('pos pos=Wbbbbbbbbbbbbbbbbbbbbeeeeeeeeeewwwwwwwwwwwwwwwwwwww');
await Scan.sendCommand('level depth=15');
await Scan.sendCommand('go think');

// Clean up when done
unsubscribeMessage();
await Scan.shutdown();
```

## API Reference

### Methods

#### `init()`
Initializes the Scan engine.

```javascript
const success = await Scan.init();
```

#### `setConfig(config)`
Configures the library's behavior regarding event throttling and emission.

```javascript
Scan.setConfig({
  throttling: {
    analysisInterval: 200,  // Time in ms between analysis events
    messageInterval: 300    // Time in ms between message events
  },
  events: {
    emitMessage: true,      // Whether to emit raw message events
    emitAnalysis: true,     // Whether to emit analysis events
    emitBestMove: true      // Whether to emit bestMove events
  }
});
```

#### `sendCommand(command)`
Sends a HUB command to the engine.

```javascript
await Scan.sendCommand('pos pos=Wbbbbbbbbbbbbbbbbbbbbeeeeeeeeeewwwwwwwwwwwwwwwwwwww');
await Scan.sendCommand('go think');
```

#### `shutdown()`
Shuts down the engine and frees resources.

```javascript
await Scan.shutdown();
```

#### `addMessageListener(callback)`
Adds a listener for raw output messages from the engine.

```javascript
const unsubscribe = Scan.addMessageListener((message) => {
  console.log('Engine says:', message);
});

// Later, to remove the listener
unsubscribe();
```

#### `addAnalysisListener(callback)`
Adds a listener for parsed analysis data.

```javascript
const unsubscribe = Scan.addAnalysisListener((data) => {
  console.log('Analysis data:', data);
  console.log('Best move:', data.bestMove);
  console.log('Score:', data.score);
  console.log('Depth:', data.depth);
});
```

#### `addBestMoveListener(callback)`
Adds a dedicated listener for "bestmove" events.

```javascript
const unsubscribe = Scan.addBestMoveListener((data) => {
  console.log('Computer chose move:', data.move);
  // Make the move on your draughts board
});
```

#### `analyzePosition(position, options)`
Helper method to set a position and start analysis.

```javascript
await Scan.analyzePosition('Wbbbbbbbbbbbbbbbbbbbbeeeeeeeeeewwwwwwwwwwwwwwwwwwww', {
  depth: 20,
  movetime: 5000
});
```

#### `stopAnalysis()`
Stops the current analysis.

```javascript
await Scan.stopAnalysis();
```

#### `getComputerMove(position, movetime, depth)`
Helper method to get a computer move in a game.

```javascript
// Computer has 1 second to choose a move
await Scan.getComputerMove('Wbbbbbbbbbbbbbbbbbbbbeeeeeeeeeewwwwwwwwwwwwwwwwwwww', 1000, 15);
```

### Data Structures

#### ScanConfig
```typescript
interface ScanConfig {
  throttling: {
    analysisInterval: number;  // Time in ms between analysis event emissions
    messageInterval: number;   // Time in ms between message event emissions
  };
  events: {
    emitMessage: boolean;      // Whether to emit raw message events
    emitAnalysis: boolean;     // Whether to emit analysis events
    emitBestMove: boolean;     // Whether to emit bestMove events
  };
}
```

#### AnalysisData
```typescript
interface AnalysisData {
  type: 'info' | 'bestmove';
  depth?: number;
  score?: number;
  bestMove?: string;
  line?: string;
  move?: string;
  nodes?: number;
  time?: number;
  nps?: number;
}
```

#### BestMoveData
```typescript
interface BestMoveData {
  type: 'bestmove';
  move: string;
  ponder?: string;
}
```

## Position Format

Positions in Scan use a specific format:
- First character: side to move ('W' for white, 'B' for black)
- Followed by 50 characters representing the board squares
- Characters: 'w' (white man), 'b' (black man), 'W' (white king), 'B' (black king), 'e' (empty)

Example starting position: `Wbbbbbbbbbbbbbbbbbbbbeeeeeeeeeewwwwwwwwwwwwwwwwwwww`

## Move Format

Moves are in standard draughts notation:
- Quiet moves: `32-28`
- Captures: `28x19x23` (all captured pieces listed)

## Common HUB Commands

```javascript
// Initialize engine
await Scan.sendCommand('hub');
await Scan.sendCommand('init');

// Set up position
await Scan.sendCommand('pos pos=Wbbbbbbbbbbbbbbbbbbbbeeeeeeeeeewwwwwwwwwwwwwwwwwwww');

// Set analysis depth
await Scan.sendCommand('level depth=20');

// Set time limit (in seconds)
await Scan.sendCommand('level move-time=3');

// Start analysis
await Scan.sendCommand('go analyze');

// Start thinking for a move
await Scan.sendCommand('go think');

// Stop calculation
await Scan.sendCommand('stop');

// Clear transposition table
await Scan.sendCommand('new-game');

// Set engine parameters
await Scan.sendCommand('set-param name=variant value=normal');
```

## Draughts Variants

Scan supports multiple draughts variants:
- `normal` - International draughts (10×10)
- `killer` - Killer draughts
- `bt` - Breakthrough draughts
- `frisian` - Frisian draughts
- `losing` - Losing draughts (giveaway)

Set variant with:
```javascript
await Scan.sendCommand('set-param name=variant value=frisian');
```

## Example: Playing Against Computer

```javascript
import Scan from 'dawikk-scan';

class DraughtsGame {
  constructor() {
    this.initialize();
  }

  async initialize() {
    // Configure for optimal game performance
    Scan.setConfig({
      events: {
        emitMessage: false,  // No need for raw messages
        emitAnalysis: false, // No need for analysis data
        emitBestMove: true   // Only need the final move
      }
    });
    
    await Scan.init();
    
    // Listen for computer moves
    this.unsubscribe = Scan.addBestMoveListener((data) => {
      console.log('Computer move:', data.move);
      this.makeMove(data.move);
    });
    
    // Initialize engine
    await Scan.sendCommand('hub');
    await Scan.sendCommand('init');
  }

  async makePlayerMove(move) {
    // Update position after player move
    // ... update your game state ...
    
    // Ask computer to respond
    await Scan.getComputerMove(this.getCurrentPosition(), 2000, 15);
  }

  makeMove(move) {
    // Apply move to your game board
    console.log('Applying move:', move);
    // ... update your game state ...
  }

  getCurrentPosition() {
    // Return current position in HUB format
    return 'Wbbbbbbbbbbbbbbbbbbbbeeeeeeeeeewwwwwwwwwwwwwwwwwwww'; // example
  }

  cleanup() {
    this.unsubscribe();
    Scan.shutdown();
  }
}
```

## Performance Tips

1. **Disable unnecessary events**:
   ```javascript
   // For computer games
   Scan.setConfig({
     events: { emitMessage: false, emitAnalysis: false, emitBestMove: true }
   });
   
   // For position analysis
   Scan.setConfig({
     events: { emitMessage: false, emitAnalysis: true, emitBestMove: false }
   });
   ```

2. **Adjust throttling for your needs**:
   ```javascript
   // More responsive (updates more frequently)
   Scan.setConfig({
     throttling: { analysisInterval: 100, messageInterval: 150 }
   });
   
   // Smoother UI (less frequent updates)
   Scan.setConfig({
     throttling: { analysisInterval: 300, messageInterval: 400 }
   });
   ```

## License

This project is licensed under the GPL-3.0 License, as it includes Scan code which is GPL-3.0 licensed.

For more information about Scan, visit the official repository.