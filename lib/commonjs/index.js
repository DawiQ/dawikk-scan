"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.ScanEventEmitter = exports.Scan = void 0;
var _reactNative = require("react-native");
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
// Type definitions for draughts/checkers

// Configuration for event throttling and filtering

// Default configuration
const DEFAULT_CONFIG = {
  throttling: {
    analysisInterval: 100,
    // Default: 100ms between analysis events
    messageInterval: 100 // Default: 100ms between message events
  },
  events: {
    emitMessage: true,
    emitAnalysis: true,
    emitBestMove: true
  }
};

// Linking error handling
const LINKING_ERROR = `The package 'dawikk-scan' doesn't seem to be linked. Make sure: \n\n` + _reactNative.Platform.select({
  ios: "- You have run 'pod install'\n",
  default: ''
}) + '- You rebuilt the app after installing the package\n' + '- You are not using Expo Go\n';

// Get the native module
const ScanModule = _reactNative.NativeModules.RNScanModule ? _reactNative.NativeModules.RNScanModule : new Proxy({}, {
  get() {
    throw new Error(LINKING_ERROR);
  }
});

// Create event emitter
const ScanEventEmitter = exports.ScanEventEmitter = new _reactNative.NativeEventEmitter(ScanModule);
class Scan {
  constructor(config) {
    // Class properties
    _defineProperty(this, "engineInitialized", void 0);
    _defineProperty(this, "listeners", void 0);
    _defineProperty(this, "analysisListeners", void 0);
    _defineProperty(this, "bestMoveListeners", void 0);
    _defineProperty(this, "outputSubscription", void 0);
    _defineProperty(this, "analysisSubscription", void 0);
    // Throttling properties
    _defineProperty(this, "config", void 0);
    _defineProperty(this, "messageBuffer", []);
    _defineProperty(this, "analysisBuffer", []);
    _defineProperty(this, "lastBestMove", null);
    _defineProperty(this, "messageThrottleTimer", null);
    _defineProperty(this, "analysisThrottleTimer", null);
    this.engineInitialized = false;
    this.listeners = [];
    this.analysisListeners = [];
    this.bestMoveListeners = [];

    // Merge provided config with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      throttling: {
        ...DEFAULT_CONFIG.throttling,
        ...((config === null || config === void 0 ? void 0 : config.throttling) || {})
      },
      events: {
        ...DEFAULT_CONFIG.events,
        ...((config === null || config === void 0 ? void 0 : config.events) || {})
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
    this.outputSubscription = ScanEventEmitter.addListener('scan-output', this.handleOutput);
    this.analysisSubscription = ScanEventEmitter.addListener('scan-analyzed-output', this.handleAnalysisOutput);
  }

  /**
   * Updates the Scan configuration.
   * @param config Partial configuration to update
   */
  setConfig(config) {
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
  async init() {
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
  async sendCommand(command) {
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
  async shutdown() {
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
  emitThrottledMessages() {
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
    this.messageThrottleTimer = setTimeout(this.emitThrottledMessages, this.config.throttling.messageInterval);
  }

  /**
   * Emits throttled analysis events based on configuration.
   */
  emitThrottledAnalysis() {
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
    this.analysisThrottleTimer = setTimeout(this.emitThrottledAnalysis, this.config.throttling.analysisInterval);
  }

  /**
   * Handles output messages from the engine.
   * @param message Message from the Scan engine.
   */
  handleOutput(message) {
    if (!this.config.events.emitMessage) return;

    // Add message to buffer
    this.messageBuffer.push(message);

    // Start throttle timer if not running
    if (this.messageThrottleTimer === null) {
      this.messageThrottleTimer = setTimeout(this.emitThrottledMessages, this.config.throttling.messageInterval);
    }
  }

  /**
   * Handles analyzed output data from the engine.
   * @param data Analyzed data from the Scan engine.
   */
  handleAnalysisOutput(data) {
    if (data.type === 'bestmove') {
      // Store latest bestmove
      this.lastBestMove = data;

      // Immediately emit bestMove events if configured
      if (this.config.events.emitBestMove) {
        this.bestMoveListeners.forEach(listener => listener(data));
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
      this.analysisBuffer.push(data);

      // Start throttle timer if not running
      if (this.analysisThrottleTimer === null) {
        this.analysisThrottleTimer = setTimeout(this.emitThrottledAnalysis, this.config.throttling.analysisInterval);
      }
    }
  }

  /**
   * Adds a message listener.
   * @param listener Function to call for each message.
   * @returns Function to remove the listener.
   */
  addMessageListener(listener) {
    this.listeners.push(listener);
    return () => this.removeMessageListener(listener);
  }

  /**
   * Adds an analysis listener.
   * @param listener Function to call for each analysis result.
   * @returns Function to remove the listener.
   */
  addAnalysisListener(listener) {
    this.analysisListeners.push(listener);
    return () => this.removeAnalysisListener(listener);
  }

  /**
   * Adds a bestmove listener.
   * @param listener Function to call for each bestmove.
   * @returns Function to remove the listener.
   */
  addBestMoveListener(listener) {
    this.bestMoveListeners.push(listener);
    return () => this.removeBestMoveListener(listener);
  }

  /**
   * Removes a message listener.
   * @param listener Listener to remove.
   */
  removeMessageListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Removes an analysis listener.
   * @param listener Listener to remove.
   */
  removeAnalysisListener(listener) {
    const index = this.analysisListeners.indexOf(listener);
    if (index !== -1) {
      this.analysisListeners.splice(index, 1);
    }
  }

  /**
   * Removes a bestmove listener.
   * @param listener Listener to remove.
   */
  removeBestMoveListener(listener) {
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
  async analyzePosition(position, options = {}) {
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
    let levelCommand = '';
    if (depth && !infinite) levelCommand += `level depth=${depth}`;
    if (movetime) levelCommand += `level move-time=${movetime}`;
    if (nodes) levelCommand += `level nodes=${nodes}`;
    if (infinite) levelCommand += 'level infinite';
    if (levelCommand) await this.sendCommand(levelCommand);
    await this.sendCommand('go analyze');
  }

  /**
   * Helper method to stop ongoing analysis.
   */
  async stopAnalysis() {
    await this.sendCommand('stop');
  }

  /**
   * Helper method to get computer move in a game.
   * @param position Position in HUB format.
   * @param movetime Time in milliseconds for the move (default 1000ms).
   * @param depth Analysis depth (default 15).
   */
  async getComputerMove(position, movetime = 1000, depth = 15) {
    await this.sendCommand('hub');
    await this.sendCommand('init');
    await this.sendCommand(`pos pos=${position}`);
    await this.sendCommand(`level move-time=${movetime / 1000}`);
    await this.sendCommand(`level depth=${depth}`);
    await this.sendCommand('go think');
  }

  /**
   * Cleans up resources when done with the library.
   */
  destroy() {
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
    this.outputSubscription.remove();
    this.analysisSubscription.remove();
    this.listeners = [];
    this.analysisListeners = [];
    this.bestMoveListeners = [];
  }
}

// Export a single instance, but allow custom configuration
exports.Scan = Scan;
var _default = exports.default = new Scan(); // Also export the class for users who want to create custom instances
//# sourceMappingURL=index.js.map