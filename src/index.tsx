import { NativeModules, NativeEventEmitter, Platform, AppState, AppStateStatus } from 'react-native';

// Type definitions for draughts/checkers
export interface AnalysisOptions {
  depth?: number;
  time?: number; // in milliseconds
  nodes?: number;
  infinite?: boolean;
}

export interface SearchOptions {
  depth?: number;
  time?: number; // in milliseconds
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

export interface ErrorData {
  error: string;
}

export interface StatusData {
  status: EngineStatus;
}

// Engine status enum
export type EngineStatus = 'stopped' | 'initializing' | 'ready' | 'thinking' | 'error';

// Supported draughts variants
export type DraughtsVariant = 'normal' | 'killer' | 'bt' | 'frisian' | 'losing';

// Configuration for the Scan engine
export interface ScanConfig {
  // Engine parameters
  variant?: DraughtsVariant;
  book?: boolean;
  bookPly?: number;
  bookMargin?: number;
  threads?: number;
  hashSize?: number;
  bitbaseSize?: number;
}

// Event listener types
type MessageListener = (message: string) => void;
type AnalysisListener = (data: AnalysisData) => void;
type BestMoveListener = (data: BestMoveData) => void;
type ErrorListener = (data: ErrorData) => void;
type StatusListener = (data: StatusData) => void;

// Error codes
export const ERROR_CODES = {
  INIT_FAILED: 'INIT_FAILED',
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  ALREADY_RUNNING: 'ALREADY_RUNNING',
  INVALID_COMMAND: 'INVALID_COMMAND',
  ENGINE_ERROR: 'ENGINE_ERROR',
  TIMEOUT: 'TIMEOUT'
} as const;

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

export class ScanEngine {
  // Properties
  private listeners: MessageListener[] = [];
  private analysisListeners: AnalysisListener[] = [];
  private bestMoveListeners: BestMoveListener[] = [];
  private errorListeners: ErrorListener[] = [];
  private statusListeners: StatusListener[] = [];
  
  private outputSubscription: any;
  private analysisSubscription: any;
  private errorSubscription: any;
  private statusSubscription: any;
  private appStateSubscription: any;
  
  private currentStatus: EngineStatus = 'stopped';
  private isInitialized = false;
  private isStarted = false;
  private pendingMoveCallback: BestMoveListener | null = null;
  
  constructor() {
    this.setupEventSubscriptions();
    this.setupAppStateHandling();
  }
  
  // Event subscription setup
  private setupEventSubscriptions(): void {
    this.outputSubscription = ScanEventEmitter.addListener(
      'scan-output',
      this.handleOutput.bind(this)
    );
    
    this.analysisSubscription = ScanEventEmitter.addListener(
      'scan-analyzed-output',
      this.handleAnalysisOutput.bind(this)
    );
    
    this.errorSubscription = ScanEventEmitter.addListener(
      'scan-error',
      this.handleError.bind(this)
    );
    
    this.statusSubscription = ScanEventEmitter.addListener(
      'scan-status',
      this.handleStatusChange.bind(this)
    );
  }
  
  // App state handling for proper lifecycle management
  private setupAppStateHandling(): void {
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange.bind(this)
    );
  }
  
  private handleAppStateChange(nextAppState: AppStateStatus): void {
    if (nextAppState === 'background' && this.isStarted) {
      // Pause engine when app goes to background
      this.sendCommand('stop').catch(console.warn);
    } else if (nextAppState === 'active' && this.isStarted) {
      // Resume engine when app becomes active
      // Engine should automatically be ready again
    }
  }
  
  // Event handlers
  private handleOutput(message: string): void {
    this.listeners.forEach(listener => {
      try {
        listener(message);
      } catch (error) {
        console.warn('Error in message listener:', error);
      }
    });
  }
  
  private handleAnalysisOutput(data: AnalysisData | BestMoveData): void {
    if (data.type === 'bestmove') {
      const moveData = data as BestMoveData;
      
      // Handle pending move callback
      if (this.pendingMoveCallback) {
        try {
          this.pendingMoveCallback(moveData);
        } catch (error) {
          console.warn('Error in move callback:', error);
        }
        this.pendingMoveCallback = null;
      }
      
      // Notify bestmove listeners
      this.bestMoveListeners.forEach(listener => {
        try {
          listener(moveData);
        } catch (error) {
          console.warn('Error in bestmove listener:', error);
        }
      });
    } else {
      const analysisData = data as AnalysisData;
      this.analysisListeners.forEach(listener => {
        try {
          listener(analysisData);
        } catch (error) {
          console.warn('Error in analysis listener:', error);
        }
      });
    }
  }
  
  private handleError(data: ErrorData): void {
    this.errorListeners.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        console.warn('Error in error listener:', error);
      }
    });
  }
  
  private handleStatusChange(data: StatusData): void {
    this.currentStatus = data.status;
    this.statusListeners.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        console.warn('Error in status listener:', error);
      }
    });
  }
  
  // Core engine methods
  
  /**
   * Initializes the Scan engine.
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    try {
      await ScanModule.initEngine();
      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize engine: ${error}`);
    }
  }
  
  /**
   * Starts the Scan engine thread.
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }
    
    if (this.isStarted) {
      return;
    }
    
    try {
      await ScanModule.startEngine();
      this.isStarted = true;
      
      // Wait for engine to be ready
      const ready = await ScanModule.waitReady(10);
      if (!ready) {
        throw new Error('Engine failed to become ready within timeout');
      }
    } catch (error) {
      throw new Error(`Failed to start engine: ${error}`);
    }
  }
  
  /**
   * Sends a HUB command to the engine.
   */
  async sendCommand(command: string): Promise<void> {
    if (!this.isStarted) {
      await this.start();
    }
    
    try {
      await ScanModule.sendCommand(command);
    } catch (error) {
      throw new Error(`Failed to send command '${command}': ${error}`);
    }
  }
  
  /**
   * Gets the current engine status.
   */
  async getStatus(): Promise<EngineStatus> {
    try {
      return await ScanModule.getStatus();
    } catch (error) {
      return 'error';
    }
  }
  
  /**
   * Checks if the engine is ready.
   */
  async isReady(): Promise<boolean> {
    try {
      return await ScanModule.isReady();
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Waits for the engine to be ready.
   */
  async waitReady(timeoutSeconds = 10): Promise<boolean> {
    try {
      return await ScanModule.waitReady(timeoutSeconds);
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Shuts down the engine.
   */
  async shutdown(): Promise<void> {
    try {
      await ScanModule.shutdownEngine();
      this.isInitialized = false;
      this.isStarted = false;
      this.currentStatus = 'stopped';
    } catch (error) {
      console.warn('Error during shutdown:', error);
    }
  }
  
  // High-level analysis methods
  
  /**
   * Analyzes a position.
   */
  async analyzePosition(position: string, options: AnalysisOptions = {}): Promise<void> {
    if (!position) {
      throw new Error('Position is required');
    }
    
    try {
      await ScanModule.analyzePosition(position, options);
    } catch (error) {
      throw new Error(`Failed to analyze position: ${error}`);
    }
  }
  
  /**
   * Gets the best move for a position.
   */
  async getBestMove(position: string, options: SearchOptions = {}): Promise<string> {
    if (!position) {
      throw new Error('Position is required');
    }
    
    return new Promise(async (resolve, reject) => {
      // Set up one-time callback for the result
      this.pendingMoveCallback = (data: BestMoveData) => {
        if (data.move) {
          resolve(data.move);
        } else {
          reject(new Error('No move returned from engine'));
        }
      };
      
      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingMoveCallback = null;
        reject(new Error('Timeout waiting for best move'));
      }, (options.time || 10000) + 5000); // Add 5s buffer
      
      try {
        await ScanModule.getBestMove(position, options);
      } catch (error) {
        clearTimeout(timeout);
        this.pendingMoveCallback = null;
        reject(error);
      }
    });
  }
  
  /**
   * Stops the current analysis.
   */
  async stopAnalysis(): Promise<void> {
    try {
      await ScanModule.stopAnalysis();
    } catch (error) {
      throw new Error(`Failed to stop analysis: ${error}`);
    }
  }
  
  // Configuration methods
  
  /**
   * Sets engine parameters.
   */
  async setParameters(params: ScanConfig): Promise<void> {
    const paramMap: Record<string, any> = {};
    
    if (params.variant) paramMap['variant'] = params.variant;
    if (params.book !== undefined) paramMap['book'] = params.book ? 'true' : 'false';
    if (params.bookPly !== undefined) paramMap['book-ply'] = params.bookPly;
    if (params.bookMargin !== undefined) paramMap['book-margin'] = params.bookMargin;
    if (params.threads !== undefined) paramMap['threads'] = params.threads;
    if (params.hashSize !== undefined) paramMap['tt-size'] = params.hashSize;
    if (params.bitbaseSize !== undefined) paramMap['bb-size'] = params.bitbaseSize;
    
    if (Object.keys(paramMap).length > 0) {
      try {
        await ScanModule.setParameters(paramMap);
      } catch (error) {
        throw new Error(`Failed to set parameters: ${error}`);
      }
    }
  }
  
  /**
   * Sets the draughts variant.
   */
  async setVariant(variant: DraughtsVariant): Promise<void> {
    await this.setParameters({ variant });
  }
  
  /**
   * Enables or disables the opening book.
   */
  async setBook(enabled: boolean): Promise<void> {
    await this.setParameters({ book: enabled });
  }
  
  /**
   * Sets the number of threads.
   */
  async setThreads(threads: number): Promise<void> {
    const clampedThreads = Math.max(1, Math.min(16, threads));
    await this.setParameters({ threads: clampedThreads });
  }
  
  /**
   * Sets the hash table size.
   */
  async setHashSize(size: number): Promise<void> {
    const clampedSize = Math.max(16, Math.min(30, size));
    await this.setParameters({ hashSize: clampedSize });
  }
  
  // Convenience methods for common operations
  
  /**
   * Sets up the engine for a new game.
   */
  async newGame(): Promise<void> {
    await this.sendCommand('new-game');
  }
  
  /**
   * Sets a position from HUB format.
   */
  async setPosition(position: string, moves: string[] = []): Promise<void> {
    let command = `pos pos=${position}`;
    if (moves.length > 0) {
      command += ` moves="${moves.join(' ')}"`;
    }
    await this.sendCommand(command);
  }
  
  /**
   * Sets a position from the starting position with moves.
   */
  async setPositionFromStart(moves: string[] = []): Promise<void> {
    let command = 'pos start';
    if (moves.length > 0) {
      command += ` moves="${moves.join(' ')}"`;
    }
    await this.sendCommand(command);
  }
  
  /**
   * Pings the engine to check responsiveness.
   */
  async ping(): Promise<boolean> {
    try {
      await this.sendCommand('ping');
      return true;
    } catch (error) {
      return false;
    }
  }
  
  // Event listener management
  
  /**
   * Adds a message listener.
   */
  addMessageListener(listener: MessageListener): () => void {
    this.listeners.push(listener);
    return () => this.removeMessageListener(listener);
  }
  
  /**
   * Adds an analysis listener.
   */
  addAnalysisListener(listener: AnalysisListener): () => void {
    this.analysisListeners.push(listener);
    return () => this.removeAnalysisListener(listener);
  }
  
  /**
   * Adds a bestmove listener.
   */
  addBestMoveListener(listener: BestMoveListener): () => void {
    this.bestMoveListeners.push(listener);
    return () => this.removeBestMoveListener(listener);
  }
  
  /**
   * Adds an error listener.
   */
  addErrorListener(listener: ErrorListener): () => void {
    this.errorListeners.push(listener);
    return () => this.removeErrorListener(listener);
  }
  
  /**
   * Adds a status listener.
   */
  addStatusListener(listener: StatusListener): () => void {
    this.statusListeners.push(listener);
    return () => this.removeStatusListener(listener);
  }
  
  /**
   * Removes a message listener.
   */
  removeMessageListener(listener: MessageListener): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }
  
  /**
   * Removes an analysis listener.
   */
  removeAnalysisListener(listener: AnalysisListener): void {
    const index = this.analysisListeners.indexOf(listener);
    if (index !== -1) {
      this.analysisListeners.splice(index, 1);
    }
  }
  
  /**
   * Removes a bestmove listener.
   */
  removeBestMoveListener(listener: BestMoveListener): void {
    const index = this.bestMoveListeners.indexOf(listener);
    if (index !== -1) {
      this.bestMoveListeners.splice(index, 1);
    }
  }
  
  /**
   * Removes an error listener.
   */
  removeErrorListener(listener: ErrorListener): void {
    const index = this.errorListeners.indexOf(listener);
    if (index !== -1) {
      this.errorListeners.splice(index, 1);
    }
  }
  
  /**
   * Removes a status listener.
   */
  removeStatusListener(listener: StatusListener): void {
    const index = this.statusListeners.indexOf(listener);
    if (index !== -1) {
      this.statusListeners.splice(index, 1);
    }
  }
  
  // Property getters
  
  /**
   * Gets the current status.
   */
  get status(): EngineStatus {
    return this.currentStatus;
  }
  
  /**
   * Checks if the engine is initialized.
   */
  get initialized(): boolean {
    return this.isInitialized;
  }
  
  /**
   * Checks if the engine is started.
   */
  get started(): boolean {
    return this.isStarted;
  }
  
  /**
   * Cleans up resources.
   */
  destroy(): void {
    // Clean up event subscriptions
    if (this.outputSubscription) {
      this.outputSubscription.remove();
    }
    if (this.analysisSubscription) {
      this.analysisSubscription.remove();
    }
    if (this.errorSubscription) {
      this.errorSubscription.remove();
    }
    if (this.statusSubscription) {
      this.statusSubscription.remove();
    }
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
    }
    
    // Clear listeners
    this.listeners = [];
    this.analysisListeners = [];
    this.bestMoveListeners = [];
    this.errorListeners = [];
    this.statusListeners = [];
    
    // Shutdown engine
    this.shutdown().catch(console.warn);
  }
}

// Export the main class and create a default instance
export default new ScanEngine();


// Export useful constants
export const STARTING_POSITION = 'Wbbbbbbbbbbbbbbbbbbbbeeeeeeeeeewwwwwwwwwwwwwwwwwwww';

export const DRAUGHTS_VARIANTS: DraughtsVariant[] = [
  'normal',
  'killer', 
  'bt',
  'frisian',
  'losing'
];

// Export utility functions
export const createScanInstance = (): ScanEngine => {
  return new ScanEngine();
};

export const parseMove = (move: string): { from: number; to: number; captures: number[] } | null => {
  if (!move || typeof move !== 'string') {
    return null;
  }
  
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

export const isValidPosition = (position: string): boolean => {
  if (!position || typeof position !== 'string') {
    return false;
  }
  
  // Basic validation for HUB format position
  // Should be: side-to-move + 50 characters for board
  if (position.length !== 51) {
    return false;
  }
  
  // First character should be W or B
  const turn = position[0];
  if (turn !== 'W' && turn !== 'B') {
    return false;
  }
  
  // Remaining characters should be w, b, W, B, or e
  const boardChars = position.slice(1);
  for (const char of boardChars) {
    if (!'wbWBe'.includes(char)) {
      return false;
    }
  }
  
  return true;
};

export const validateMove = (move: string): boolean => {
  return parseMove(move) !== null;
};