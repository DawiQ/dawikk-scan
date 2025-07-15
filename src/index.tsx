import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// Typy specyficzne dla warcabów
export interface DraughtsPosition {
  white: number[];
  black: number[];
  whiteKings: number[];
  blackKings: number[];
  sideToMove: 'white' | 'black';
}

export interface DraughtsMove {
  from: number;
  to: number;
  captures?: number[];
  promotion?: boolean;
}

export interface DraughtsAnalysisData {
  type: 'info' | 'done' | 'error' | 'ready';
  depth?: number;
  score?: number;
  move?: string;
  line?: string;
  ponder?: string;
  variant?: string;
  nodes?: number;
  time?: number;
  pv?: string;
  status?: string;
  error?: string;
}

export interface DraughtsAnalysisOptions {
  depth?: number;
  movetime?: number;
  variant?: 'normal' | 'frisian' | 'killer' | 'losing' | 'bt';
  nodes?: number;
}

// Konfiguracja podobna do Stockfisha ale dla warcabów
export interface ScanConfig {
  throttling: {
    analysisInterval: number;
    messageInterval: number;
    commandTimeout: number;
  };
  events: {
    emitMessage: boolean;
    emitAnalysis: boolean;
    emitBestMove: boolean;
    emitErrors: boolean;
  };
}

const DEFAULT_CONFIG: ScanConfig = {
  throttling: {
    analysisInterval: 100,
    messageInterval: 100,
    commandTimeout: 5000,
  },
  events: {
    emitMessage: true,
    emitAnalysis: true,
    emitBestMove: true,
    emitErrors: true,
  }
};

const LINKING_ERROR =
  `The package 'dawikk-scan' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

const ScanModule = NativeModules.RNScanModule
  ? NativeModules.RNScanModule
  : new Proxy({}, {
      get() {
        throw new Error(LINKING_ERROR);
      },
    });

export const ScanEventEmitter = new NativeEventEmitter(ScanModule);

class Scan {
  engineInitialized: boolean;
  private config: ScanConfig;
  private currentVariant: string;
  private pendingCommands: Map<string, { resolve: Function; reject: Function; timeout: ReturnType<typeof setTimeout> }>;
  private commandId: number;
  private _isAnalyzing: boolean;
  
  constructor(config?: Partial<ScanConfig>) {
    this.engineInitialized = false;
    this.currentVariant = 'normal';
    this.pendingCommands = new Map();
    this.commandId = 0;
    this._isAnalyzing = false;
    
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

    // Setup error handling
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    ScanEventEmitter.addListener('scan-error', (error: any) => {
      console.error('Scan engine error:', error);
      if (this.config.events.emitErrors) {
        // Reject pending commands on error
        this.pendingCommands.forEach(({ reject }) => {
          reject(new Error(error.error || 'Unknown engine error'));
        });
        this.pendingCommands.clear();
      }
    });

    ScanEventEmitter.addListener('scan-ready', (status: any) => {
      console.log('Scan engine status:', status);
    });
  }

  /**
   * Inicjalizuje silnik Scan z określonym wariantem warcabów
   */
  async init(variant: string = 'normal'): Promise<boolean> {
    if (this.engineInitialized) {
      return true;
    }

    try {
      console.log(`Initializing Scan engine with variant: ${variant}`);
      
      await ScanModule.initEngine(variant);
      this.engineInitialized = true;
      this.currentVariant = variant;
      
      // Poczekaj na gotowość silnika
      await this.waitForEngineReady(3000);
      
      console.log('Scan engine initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize Scan engine:', error);
      this.engineInitialized = false;
      return false;
    }
  }

  /**
   * Czeka na gotowość silnika
   */
  private async waitForEngineReady(timeout: number = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        subscription.remove();
        reject(new Error('Timeout waiting for engine ready'));
      }, timeout);

      const subscription = ScanEventEmitter.addListener('scan-ready', (status: any) => {
        if (status.status === 'initialized' || status.status === 'ready') {
          clearTimeout(timer);
          subscription.remove();
          resolve();
        }
      });
    });
  }

  /**
   * Wysyła komendę Hub protocol do silnika z timeout
   */
  async sendCommand(command: string): Promise<boolean> {
    if (!this.engineInitialized) {
      await this.init();
    }

    try {
      const result = await this.sendCommandWithTimeout(command, this.config.throttling.commandTimeout);
      return result;
    } catch (error) {
      console.error('Failed to send command to Scan:', error);
      return false;
    }
  }

  /**
   * Wysyła komendę z timeout
   */
  private async sendCommandWithTimeout(command: string, timeout: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Command timeout: ${command}`));
      }, timeout);

      ScanModule.sendCommand(command)
        .then((result: boolean) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error: any) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Czeka na odpowiedź silnika
   */
  private async waitForResponse(expectedResponse: string | string[], timeout: number = 2000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        subscription.remove();
        reject(new Error(`Timeout waiting for response: ${expectedResponse}`));
      }, timeout);

      const subscription = ScanEventEmitter.addListener('scan-output', (message: string) => {
        const responses = Array.isArray(expectedResponse) ? expectedResponse : [expectedResponse];
        
        for (const response of responses) {
          if (message.includes(response)) {
            clearTimeout(timer);
            subscription.remove();
            resolve(message);
            return;
          }
        }
      });
    });
  }

  /**
   * Zatrzymuje analizę
   */
  async stopAnalysis(): Promise<void> {
    if (this._isAnalyzing) {
      await this.sendCommand('stop');
      this._isAnalyzing = false;
    }
  }

  /**
   * Analizuje pozycję warcabową używając Hub protocol
   */
  async analyzePosition(position: string, options: DraughtsAnalysisOptions = {}): Promise<void> {
    if (this._isAnalyzing) {
      await this.stopAnalysis();
    }

    const { depth = 15, movetime, variant = this.currentVariant, nodes } = options;

    try {
      console.log(`Starting analysis of position: ${position}`);
      
      // Inicjalizacja Hub protocol
      await this.sendCommand('hub');
      await this.waitForResponse(['wait', 'ready'], 2000);
      
      // Inicjalizuj silnik
      await this.sendCommand('init');
      await this.waitForResponse('ready', 2000);
      
      // Ustaw wariant jeśli różny
      if (variant !== this.currentVariant) {
        await this.sendCommand(`set-param name=variant value=${variant}`);
        this.currentVariant = variant;
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Ustaw pozycję
      await this.sendCommand(`pos pos=${position}`);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Ustaw poziom analizy
      let levelCommand = `level depth=${depth}`;
      if (movetime) levelCommand += ` move-time=${movetime}`;
      if (nodes) levelCommand += ` nodes=${nodes}`;
      
      await this.sendCommand(levelCommand);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Rozpocznij analizę
      this._isAnalyzing = true;
      await this.sendCommand('go analyze=true');
      
      console.log('Analysis started successfully');
    } catch (error) {
      console.error('Analysis failed:', error);
      this._isAnalyzing = false;
      throw error;
    }
  }

  /**
   * Pobiera najlepszy ruch dla pozycji
   */
  async getBestMove(position: string, options: DraughtsAnalysisOptions = {}): Promise<void> {
    if (this._isAnalyzing) {
      await this.stopAnalysis();
    }

    const { depth = 12, movetime = 1000, variant = this.currentVariant, nodes } = options;

    try {
      console.log(`Getting best move for position: ${position}`);
      
      await this.sendCommand('hub');
      await this.waitForResponse(['wait', 'ready'], 2000);
      
      await this.sendCommand('init');
      await this.waitForResponse('ready', 2000);
      
      if (variant !== this.currentVariant) {
        await this.sendCommand(`set-param name=variant value=${variant}`);
        this.currentVariant = variant;
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      await this.sendCommand(`pos pos=${position}`);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      let levelCommand = `level depth=${depth}`;
      if (movetime) levelCommand += ` move-time=${movetime}`;
      if (nodes) levelCommand += ` nodes=${nodes}`;
      
      await this.sendCommand(levelCommand);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      this._isAnalyzing = true;
      await this.sendCommand('go think=true');
      
      console.log('Best move search started');
    } catch (error) {
      console.error('Best move search failed:', error);
      this._isAnalyzing = false;
      throw error;
    }
  }

  /**
   * Ustaw wariant warcabów
   */
  async setVariant(variant: string): Promise<boolean> {
    try {
      const result = await ScanModule.setVariant(variant);
      if (result) {
        this.currentVariant = variant;
      }
      return result;
    } catch (error) {
      console.error('Failed to set variant:', error);
      return false;
    }
  }

  /**
   * Pobierz format pozycji
   */
  async getPositionFormat(): Promise<string> {
    try {
      return await ScanModule.getPositionFormat();
    } catch (error) {
      console.error('Failed to get position format:', error);
      return '';
    }
  }

  /**
   * Konwertuje pozycję z obiektu na string format
   */
  positionToString(position: DraughtsPosition): string {
    const { white, black, whiteKings, blackKings, sideToMove } = position;
    
    const side = sideToMove === 'white' ? 'W' : 'B';
    
    // Połącz białe pionki i damki
    const allWhite = [...white, ...whiteKings];
    const allBlack = [...black, ...blackKings];
    
    let result = side;
    
    if (allWhite.length > 0) {
      result += `:W${allWhite.join(',')}`;
      if (whiteKings.length > 0) {
        result += `,K${whiteKings.join(',')}`;
      }
    }
    
    if (allBlack.length > 0) {
      result += `:B${allBlack.join(',')}`;
      if (blackKings.length > 0) {
        result += `,K${blackKings.join(',')}`;
      }
    }
    
    return result;
  }

  /**
   * Konwertuje string pozycji na obiekt
   */
  parsePosition(positionString: string): DraughtsPosition {
    const parts = positionString.split(':');
    const sideToMove = parts[0] === 'W' ? 'white' : 'black';
    
    let white: number[] = [];
    let black: number[] = [];
    let whiteKings: number[] = [];
    let blackKings: number[] = [];
    
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      
      if (part.startsWith('W')) {
        const pieces = part.substring(1).split(',');
        for (const piece of pieces) {
          if (piece.startsWith('K')) {
            whiteKings.push(...piece.substring(1).split(',').map(n => parseInt(n)));
          } else {
            white.push(parseInt(piece));
          }
        }
      } else if (part.startsWith('B')) {
        const pieces = part.substring(1).split(',');
        for (const piece of pieces) {
          if (piece.startsWith('K')) {
            blackKings.push(...piece.substring(1).split(',').map(n => parseInt(n)));
          } else {
            black.push(parseInt(piece));
          }
        }
      }
    }
    
    return { white, black, whiteKings, blackKings, sideToMove };
  }

  /**
   * Parsuje ruch ze stringu
   */
  parseMove(moveString: string): DraughtsMove | null {
    try {
      // Format: "from-to" lub "fromxto" dla bicia
      const isCapture = moveString.includes('x');
      const separator = isCapture ? 'x' : '-';
      const parts = moveString.split(separator);
      
      if (parts.length < 2) return null;
      
      const from = parseInt(parts[0]);
      const to = parseInt(parts[parts.length - 1]);
      
      const captures: number[] = [];
      if (isCapture && parts.length > 2) {
        for (let i = 1; i < parts.length - 1; i++) {
          captures.push(parseInt(parts[i]));
        }
      }
      
      return {
        from,
        to,
        captures: captures.length > 0 ? captures : undefined
      };
    } catch (error) {
      console.error('Failed to parse move:', moveString, error);
      return null;
    }
  }

  /**
   * Nasłuchuje wyjścia silnika
   */
  addOutputListener(listener: (message: string) => void): () => void {
    const subscription = ScanEventEmitter.addListener('scan-output', listener);
    return () => subscription.remove();
  }

  /**
   * Nasłuchuje analizowanych danych
   */
  addAnalysisListener(listener: (data: DraughtsAnalysisData) => void): () => void {
    const subscription = ScanEventEmitter.addListener('scan-analyzed-output', (data: DraughtsAnalysisData) => {
      if (data.type === 'done') {
        this._isAnalyzing = false;
      }
      listener(data);
    });
    return () => subscription.remove();
  }

  /**
   * Nasłuchuje błędów
   */
  addErrorListener(listener: (error: any) => void): () => void {
    const subscription = ScanEventEmitter.addListener('scan-error', listener);
    return () => subscription.remove();
  }

  /**
   * Sprawdza czy silnik jest zainicjalizowany
   */
  isInitialized(): boolean {
    return this.engineInitialized;
  }

  /**
   * Sprawdza czy trwa analiza
   */
  isAnalyzing(): boolean {
    return this._isAnalyzing;
  }

  /**
   * Pobiera aktualny wariant
   */
  getCurrentVariant(): string {
    return this.currentVariant;
  }

  /**
   * Zatrzymuje silnik
   */
  async shutdown(): Promise<boolean> {
    if (!this.engineInitialized) {
      return true;
    }

    try {
      console.log('Shutting down Scan engine');
      
      await this.stopAnalysis();
      await ScanModule.shutdownEngine();
      
      this.engineInitialized = false;
      this._isAnalyzing = false;
      
      // Clear pending commands
      this.pendingCommands.forEach(({ reject }) => {
        reject(new Error('Engine shutdown'));
      });
      this.pendingCommands.clear();
      
      console.log('Scan engine shutdown successfully');
      return true;
    } catch (error) {
      console.error('Failed to shutdown Scan engine:', error);
      return false;
    }
  }
}

export default new Scan();
export { Scan };