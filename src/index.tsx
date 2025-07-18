import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// Type definitions for draughts/checkers
export interface AnalysisOptions {
  depth?: number;
  movetime?: number;
  nodes?: number;
  infinite?: boolean;
}

export interface AnalysisData {
  type: 'info' | 'bestmove' | 'id' | 'param';
  depth?: number;
  score?: number;
  bestMove?: string;
  line?: string;
  move?: string;
  nodes?: number;
  time?: number;
  nps?: number;
  meanDepth?: number;
  fen?: string;
  
  // Engine identification data
  name?: string;
  version?: string;
  author?: string;
  country?: string;
  
  // Parameter data
  value?: string;
  min?: string;
  max?: string;
  values?: string;
  
  [key: string]: any;
}

export interface BestMoveData {
  type: 'bestmove';
  move: string;
  ponder?: string;
}

// Configuration for event throttling and filtering
export interface ScanConfig {
  // Throttling intervals (in ms)
  throttling: {
    analysisInterval: number;  // Time between analysis event emissions
    messageInterval: number;   // Time between message event emissions
  };
  // Event emission control
  events: {
    emitMessage: boolean;      // Whether to emit raw message events
    emitAnalysis: boolean;     // Whether to emit analysis events
    emitBestMove: boolean;     // Whether to emit bestMove events
  };
}

// Supported draughts variants
export type DraughtsVariant = 'normal' | 'killer' | 'bt' | 'frisian' | 'losing';

type MessageListener = (message: string) => void;
type AnalysisListener = (data: AnalysisData) => void;
type BestMoveListener = (data: BestMoveData) => void;

// Default configuration
const DEFAULT_CONFIG: ScanConfig = {
  throttling: {
    analysisInterval: 100,   // Default: 100ms between analysis events
    messageInterval: 100,    // Default: 100ms between message events
  },
  events: {
    emitMessage: true,
    emitAnalysis: true,
    emitBestMove: true,
  }
};

// Linking error handling
const LINKING_ERROR =
  `The package 'dawikk-scan' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

// Get the native module
const ScanModule = NativeModules.RNScanModule
  ? NativeModules.RNScanModule
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

// Create event emitter
export const ScanEventEmitter = new NativeEventEmitter(ScanModule);

class Scan {
  // Class properties
  engineInitialized: boolean;
  private listeners: MessageListener[];
  private analysisListeners: AnalysisListener[];
  private bestMoveListeners: BestMoveListener[];
  private outputSubscription: any;
  private analysisSubscription: any;
  
  // Throttling properties
  private config: ScanConfig;
  private messageBuffer: string[] = [];
  private analysisBuffer: AnalysisData[] = [];
  private lastBestMove: BestMoveData | null = null;
  private messageThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private analysisThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  
  constructor(config?: Partial<ScanConfig>) {
    this.engineInitialized = false;
    this.listeners = [];
    this.analysisListeners = [];
    this.bestMoveListeners = [];
    
    // Merge provided config with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      throttling: {
        ...DEFAULT_CONFIG.throttling,
        ...(config?.throttling || {})
      },
      events: {
        ...DEFAULT_CONFIG.events,
        ...(config?.events || {})
      }
    };
    
    // Bind methods
    this.init = this.init.bind(this);
    this.sendCommand = this.sendCommand.bind(this);
    this.shutdown = this.shutdown.bind(this);
    this.addMessageListener = this.addMessageListener.bind(this);
    this.addAnalysisListener = this.addAnalysisListener.bind(this);
    this.addBestMoveListener = this.addBestMoveListener.bind(this);
    this.removeMessageListener = this.removeMessageListener.bind(this);
    this.removeAnalysisListener = this.removeAnalysisListener.bind(this);
    this.removeBestMoveListener = this.removeBestMoveListener.bind(this);
    this.handleOutput = this.handleOutput.bind(this);
    this.handleAnalysisOutput = this.handleAnalysisOutput.bind(this);
    this.emitThrottledMessages = this.emitThrottledMessages.bind(this);
    this.emitThrottledAnalysis = this.emitThrottledAnalysis.bind(this);
    this.setConfig = this.setConfig.bind(this);
    
    // Set up event subscriptions
    this.outputSubscription = ScanEventEmitter.addListener(
      'scan-output',
      this.handleOutput
    );
    
    this.analysisSubscription = ScanEventEmitter.addListener(
      'scan-analyzed-output',
      this.handleAnalysisOutput
    );
  }
  
  /**
   * Updates the Scan configuration.
   * @param config Partial configuration to update
   */
  setConfig(config: Partial<ScanConfig>): void {
    this.config = {
      ...this.config,
      throttling: {
        ...this.config.throttling,
        ...(config.throttling || {})
      },
      events: {
        ...this.config.events,
        ...(config.events || {})
      }
    };
  }
  
  /**
   * Initializes the Scan engine.
   * @returns Promise resolved as true if initialization succeeded.
   */
  async init(): Promise<boolean> {
    if (this.engineInitialized) {
      return true;
    }
    
    try {
      await ScanModule.initEngine();
      this.engineInitialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize Scan engine:', error);
      return false;
    }
  }
  
  /**
   * Sends a HUB command to the Scan engine.
   * @param command HUB command to send.
   * @returns Promise resolved as true if the command was sent.
   */
  async sendCommand(command: string): Promise<boolean> {
    if (!this.engineInitialized) {
      await this.init();
    }
    
    try {
      return await ScanModule.sendCommand(command);
    } catch (error) {
      console.error('Failed to send command to Scan:', error);
      return false;
    }
  }
  
  /**
   * Shuts down the Scan engine.
   * @returns Promise resolved as true if shutdown succeeded.
   */
  async shutdown(): Promise<boolean> {
    if (!this.engineInitialized) {
      return true;
    }
    
    // Clear any pending throttle timers
    if (this.messageThrottleTimer) {
      clearTimeout(this.messageThrottleTimer);
      this.messageThrottleTimer = null;
    }
    
    if (this.analysisThrottleTimer) {
      clearTimeout(this.analysisThrottleTimer);
      this.analysisThrottleTimer = null;
    }
    
    try {
      await ScanModule.shutdownEngine();
      this.engineInitialized = false;
      return true;
    } catch (error) {
      console.error('Failed to shutdown Scan engine:', error);
      return false;
    }
  }
  
  /**
   * Emits throttled message events based on configuration.
   */
  private emitThrottledMessages(): void {
    if (this.messageBuffer.length === 0 || !this.config.events.emitMessage) {
      this.messageThrottleTimer = null;
      return;
    }
    
    // Only emit the latest message
    const latestMessage = this.messageBuffer[this.messageBuffer.length - 1];
    this.listeners.forEach(listener => listener(latestMessage));
    
    // Clear buffer after emitting
    this.messageBuffer = [];
    
    // Schedule next emission if needed
    this.messageThrottleTimer = setTimeout(
      this.emitThrottledMessages,
      this.config.throttling.messageInterval
    );
  }
  
  /**
   * Emits throttled analysis events based on configuration.
   */
  private emitThrottledAnalysis(): void {
    if (this.analysisBuffer.length === 0 || !this.config.events.emitAnalysis) {
      this.analysisThrottleTimer = null;
      return;
    }
    
    // Emit the latest analysis data
    const latestAnalysis = this.analysisBuffer[this.analysisBuffer.length - 1];
    this.analysisListeners.forEach(listener => listener(latestAnalysis));
    
    // Clear buffer after emitting
    this.analysisBuffer = [];
    
    // Schedule next emission if needed
    this.analysisThrottleTimer = setTimeout(
      this.emitThrottledAnalysis,
      this.config.throttling.analysisInterval
    );
  }
  
  /**
   * Handles output messages from the engine.
   * @param message Message from the Scan engine.
   */
  handleOutput(message: string): void {
    if (!this.config.events.emitMessage) return;
    
    // Add message to buffer
    this.messageBuffer.push(message);
    
    // Start throttle timer if not running
    if (this.messageThrottleTimer === null) {
      this.messageThrottleTimer = setTimeout(
        this.emitThrottledMessages,
        this.config.throttling.messageInterval
      );
    }
  }
  
  /**
   * Handles analyzed output data from the engine.
   * @param data Analyzed data from the Scan engine.
   */
  handleAnalysisOutput(data: AnalysisData | BestMoveData): void {
    if (data.type === 'bestmove') {
      // Store latest bestmove
      this.lastBestMove = data as BestMoveData;
      
      // Immediately emit bestMove events if configured
      if (this.config.events.emitBestMove) {
        this.bestMoveListeners.forEach(listener => 
          listener(data as BestMoveData));
      }
      
      // Clear analysis buffer when bestmove arrives
      this.analysisBuffer = [];
      
      // Cancel any pending analysis emissions
      if (this.analysisThrottleTimer) {
        clearTimeout(this.analysisThrottleTimer);
        this.analysisThrottleTimer = null;
      }
    } else if (data.type === 'info') {
      // Update analysis buffer with latest data
      this.analysisBuffer.push(data as AnalysisData);
      
      // Start throttle timer if not running
      if (this.analysisThrottleTimer === null) {
        this.analysisThrottleTimer = setTimeout(
          this.emitThrottledAnalysis,
          this.config.throttling.analysisInterval
        );
      }
    } else {
      // For 'id', 'param', and other types, emit immediately to analysis listeners
      if (this.config.events.emitAnalysis) {
        this.analysisListeners.forEach(listener => listener(data as AnalysisData));
      }
    }
  }
  
  /**
   * Adds a message listener.
   * @param listener Function to call for each message.
   * @returns Function to remove the listener.
   */
  addMessageListener(listener: MessageListener): () => void {
    this.listeners.push(listener);
    return () => this.removeMessageListener(listener);
  }
  
  /**
   * Adds an analysis listener.
   * @param listener Function to call for each analysis result.
   * @returns Function to remove the listener.
   */
  addAnalysisListener(listener: AnalysisListener): () => void {
    this.analysisListeners.push(listener);
    return () => this.removeAnalysisListener(listener);
  }
  
  /**
   * Adds a bestmove listener.
   * @param listener Function to call for each bestmove.
   * @returns Function to remove the listener.
   */
  addBestMoveListener(listener: BestMoveListener): () => void {
    this.bestMoveListeners.push(listener);
    return () => this.removeBestMoveListener(listener);
  }
  
  /**
   * Removes a message listener.
   * @param listener Listener to remove.
   */
  removeMessageListener(listener: MessageListener): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }
  
  /**
   * Removes an analysis listener.
   * @param listener Listener to remove.
   */
  removeAnalysisListener(listener: AnalysisListener): void {
    const index = this.analysisListeners.indexOf(listener);
    if (index !== -1) {
      this.analysisListeners.splice(index, 1);
    }
  }
  
  /**
   * Removes a bestmove listener.
   * @param listener Listener to remove.
   */
  removeBestMoveListener(listener: BestMoveListener): void {
    const index = this.bestMoveListeners.indexOf(listener);
    if (index !== -1) {
      this.bestMoveListeners.splice(index, 1);
    }
  }
  
  /**
   * Helper method to set position and start analysis.
   * @param position Position in HUB format (WB notation).
   * @param options Analysis options.
   */
  async analyzePosition(position: string, options: AnalysisOptions = {}): Promise<void> {
    const { 
      depth = 20, 
      movetime, 
      nodes,
      infinite = false
    } = options;
    
    await this.sendCommand('hub');
    await this.sendCommand('init');
    await this.sendCommand('new-game');
    await this.sendCommand(`pos pos=${position}`);
    
    let levelCommands: string[] = [];
    if (depth && !infinite) levelCommands.push(`level depth=${depth}`);
    if (movetime) levelCommands.push(`level move-time=${movetime / 1000}`);
    if (nodes) levelCommands.push(`level nodes=${nodes}`);
    if (infinite) levelCommands.push('level infinite');
    
    for (const command of levelCommands) {
      await this.sendCommand(command);
    }
    
    await this.sendCommand('go analyze');
  }
  
  /**
   * Helper method to stop ongoing analysis.
   */
  async stopAnalysis(): Promise<void> {
    await this.sendCommand('stop');
  }
  
  /**
   * Helper method to get computer move in a game.
   * @param position Position in HUB format.
   * @param movetime Time in milliseconds for the move (default 1000ms).
   * @param depth Analysis depth (default 15).
   */
  async getComputerMove(position: string, movetime: number = 1000, depth: number = 15): Promise<void> {
    await this.sendCommand('hub');
    await this.sendCommand('init');
    await this.sendCommand(`pos pos=${position}`);
    await this.sendCommand(`level move-time=${movetime / 1000}`);
    await this.sendCommand(`level depth=${depth}`);
    await this.sendCommand('go think');
  }
  
  /**
   * Sets the engine variant (game rules).
   * @param variant One of: normal, killer, bt, frisian, losing
   */
  async setVariant(variant: DraughtsVariant): Promise<void> {
    await this.sendCommand(`set-param name=variant value=${variant}`);
  }
  
  /**
   * Enables or disables the opening book.
   * @param enabled Whether to use opening book
   */
  async setBook(enabled: boolean): Promise<void> {
    await this.sendCommand(`set-param name=book value=${enabled ? 'true' : 'false'}`);
  }
  
  /**
   * Sets the number of threads for search.
   * @param threads Number of threads (1-16)
   */
  async setThreads(threads: number): Promise<void> {
    const clampedThreads = Math.max(1, Math.min(16, threads));
    await this.sendCommand(`set-param name=threads value=${clampedThreads}`);
  }
  
  /**
   * Sets the transposition table size.
   * @param size Size as power of 2 (16-30, represents 2^size entries)
   */
  async setHashSize(size: number): Promise<void> {
    const clampedSize = Math.max(16, Math.min(30, size));
    await this.sendCommand(`set-param name=tt-size value=${clampedSize}`);
  }
  
  /**
   * Sets the bitbase size (endgame database size).
   * @param size Maximum number of pieces for bitbase lookup (0-7)
   */
  async setBitbaseSize(size: number): Promise<void> {
    const clampedSize = Math.max(0, Math.min(7, size));
    await this.sendCommand(`set-param name=bb-size value=${clampedSize}`);
  }
  
  /**
   * Sets the opening book depth.
   * @param ply Number of plies to use book (0-20)
   */
  async setBookPly(ply: number): Promise<void> {
    const clampedPly = Math.max(0, Math.min(20, ply));
    await this.sendCommand(`set-param name=book-ply value=${clampedPly}`);
  }
  
  /**
   * Sets the opening book margin.
   * @param margin Book selection margin in centipawns (0-100)
   */
  async setBookMargin(margin: number): Promise<void> {
    const clampedMargin = Math.max(0, Math.min(100, margin));
    await this.sendCommand(`set-param name=book-margin value=${clampedMargin}`);
  }
  
  /**
   * Sets a position with moves applied.
   * @param startPosition Starting position in HUB format
   * @param moves Array of moves in HUB notation
   */
  async setPositionWithMoves(startPosition: string, moves: string[] = []): Promise<void> {
    let command = `pos pos=${startPosition}`;
    if (moves.length > 0) {
      command += ` moves="${moves.join(' ')}"`;
    }
    await this.sendCommand(command);
  }
  
  /**
   * Sets a position from start with moves.
   * @param moves Array of moves in HUB notation from starting position
   */
  async setPositionFromStart(moves: string[] = []): Promise<void> {
    let command = 'pos start';
    if (moves.length > 0) {
      command += ` moves="${moves.join(' ')}"`;
    }
    await this.sendCommand(command);
  }
  
  /**
   * Clears the transposition table and starts a new game.
   */
  async newGame(): Promise<void> {
    await this.sendCommand('new-game');
  }
  
  /**
   * Pings the engine to check if it's responsive.
   * @returns Promise that resolves when pong is received
   */
  async ping(): Promise<boolean> {
    return new Promise((resolve) => {
      const listener = this.addMessageListener((message) => {
        if (message === 'pong') {
          unsubscribe();
          resolve(true);
        }
      });
      
      const unsubscribe = listener;
      this.sendCommand('ping');
      
      // Timeout after 5 seconds
      setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, 5000);
    });
  }
  
  /**
   * Gets engine information.
   * @returns Promise that resolves with engine info
   */
  async getEngineInfo(): Promise<AnalysisData | null> {
    return new Promise((resolve) => {
      const listener = this.addAnalysisListener((data) => {
        if (data.type === 'id') {
          unsubscribe();
          resolve(data);
        }
      });
      
      const unsubscribe = listener;
      this.sendCommand('hub');
      
      // Timeout after 5 seconds
      setTimeout(() => {
        unsubscribe();
        resolve(null);
      }, 5000);
    });
  }
  
  /**
   * Sets analysis level with various options.
   * @param options Analysis level options
   */
  async setLevel(options: {
    depth?: number;
    nodes?: number;
    movetime?: number;
    time?: number;
    moves?: number;
    inc?: number;
    infinite?: boolean;
    ponder?: boolean;
  }): Promise<void> {
    const commands: string[] = [];
    
    if (options.depth !== undefined) {
      commands.push(`level depth=${options.depth}`);
    }
    if (options.nodes !== undefined) {
      commands.push(`level nodes=${options.nodes}`);
    }
    if (options.movetime !== undefined) {
      commands.push(`level move-time=${options.movetime}`);
    }
    if (options.time !== undefined) {
      commands.push(`level time=${options.time}`);
    }
    if (options.moves !== undefined) {
      commands.push(`level moves=${options.moves}`);
    }
    if (options.inc !== undefined) {
      commands.push(`level inc=${options.inc}`);
    }
    if (options.infinite) {
      commands.push('level infinite');
    }
    if (options.ponder) {
      commands.push('level ponder');
    }
    
    for (const command of commands) {
      await this.sendCommand(command);
    }
  }
  
  /**
   * Starts engine thinking (for move selection).
   * @param options Optional thinking parameters
   */
  async startThinking(options: {
    position?: string;
    depth?: number;
    movetime?: number;
    ponder?: boolean;
  } = {}): Promise<void> {
    if (options.position) {
      await this.sendCommand(`pos pos=${options.position}`);
    }
    
    if (options.depth || options.movetime) {
      await this.setLevel({
        depth: options.depth,
        movetime: options.movetime,
        ponder: options.ponder
      });
    }
    
    if (options.ponder) {
      await this.sendCommand('go ponder');
    } else {
      await this.sendCommand('go think');
    }
  }
  
  /**
   * Sends a ponder hit command (when pondered move is played).
   */
  async ponderHit(): Promise<void> {
    await this.sendCommand('ponder-hit');
  }
  
  /**
   * Gets the last received best move.
   * @returns Last best move data or null
   */
  getLastBestMove(): BestMoveData | null {
    return this.lastBestMove;
  }
  
  /**
   * Checks if engine is initialized.
   * @returns True if engine is initialized
   */
  isInitialized(): boolean {
    return this.engineInitialized;
  }
  
  /**
   * Gets current configuration.
   * @returns Current configuration
   */
  getConfig(): ScanConfig {
    return { ...this.config };
  }
  
  /**
   * Cleans up resources when done with the library.
   */
  destroy(): void {
    // Clear any pending throttle timers
    if (this.messageThrottleTimer) {
      clearTimeout(this.messageThrottleTimer);
      this.messageThrottleTimer = null;
    }
    
    if (this.analysisThrottleTimer) {
      clearTimeout(this.analysisThrottleTimer);
      this.analysisThrottleTimer = null;
    }
    
    this.shutdown().catch(console.error);
    
    // Remove event subscriptions
    if (this.outputSubscription) {
      this.outputSubscription.remove();
    }
    if (this.analysisSubscription) {
      this.analysisSubscription.remove();
    }
    
    // Clear listeners
    this.listeners = [];
    this.analysisListeners = [];
    this.bestMoveListeners = [];
    
    // Clear buffers
    this.messageBuffer = [];
    this.analysisBuffer = [];
    this.lastBestMove = null;
  }
}

// Export a single instance, but allow custom configuration
export default new Scan();

// Also export the class for users who want to create custom instances
export { Scan };

// Export useful constants
export const STARTING_POSITION = 'W:W31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50:B1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20';

export const DRAUGHTS_VARIANTS: DraughtsVariant[] = [
  'normal',
  'killer', 
  'bt',
  'frisian',
  'losing'
];

// Export utility functions
export const createScanInstance = (config?: Partial<ScanConfig>): Scan => {
  return new Scan(config);
};

export const parseMove = (move: string): { from: number; to: number; captures: number[] } | null => {
  // Parse move format like "32-28" or "28x19x23"
  const isCapture = move.includes('x');
  
  if (!isCapture) {
    // Simple move: "32-28"
    const parts = move.split('-');
    if (parts.length === 2) {
      const from = parseInt(parts[0], 10);
      const to = parseInt(parts[1], 10);
      if (!isNaN(from) && !isNaN(to)) {
        return { from, to, captures: [] };
      }
    }
  } else {
    // Capture: "28x19x23"
    const parts = move.split('x');
    if (parts.length >= 2) {
      const from = parseInt(parts[0], 10);
      const to = parseInt(parts[parts.length - 1], 10);
      const captures = parts.slice(1, -1).map(p => parseInt(p, 10)).filter(n => !isNaN(n));
      
      if (!isNaN(from) && !isNaN(to)) {
        return { from, to, captures };
      }
    }
  }
  
  return null;
};

export const formatMove = (from: number, to: number, captures: number[] = []): string => {
  if (captures.length === 0) {
    return `${from}-${to}`;
  } else {
    return `${from}x${captures.join('x')}x${to}`;
  }
};