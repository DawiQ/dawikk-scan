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
  type: 'info' | 'done';
  depth?: number;
  score?: number;
  move?: string;
  line?: string;
  ponder?: string;
  variant?: string;
}

export interface DraughtsAnalysisOptions {
  depth?: number;
  movetime?: number;
  variant?: 'normal' | 'frisian' | 'killer' | 'losing';
}

// Konfiguracja podobna do Stockfisha ale dla warcabów
export interface ScanConfig {
  throttling: {
    analysisInterval: number;
    messageInterval: number;
  };
  events: {
    emitMessage: boolean;
    emitAnalysis: boolean;
    emitBestMove: boolean;
  };
}

const DEFAULT_CONFIG: ScanConfig = {
  throttling: {
    analysisInterval: 100,
    messageInterval: 100,
  },
  events: {
    emitMessage: true,
    emitAnalysis: true,
    emitBestMove: true,
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
  
  constructor(config?: Partial<ScanConfig>) {
    this.engineInitialized = false;
    this.currentVariant = 'normal';
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
  }

  /**
   * Inicjalizuje silnik Scan z określonym wariantem warcabów
   */
  async init(variant: string = 'normal'): Promise<boolean> {
    if (this.engineInitialized) {
      return true;
    }

    try {
      await ScanModule.initEngine(variant);
      this.engineInitialized = true;
      this.currentVariant = variant;
      return true;
    } catch (error) {
      console.error('Failed to initialize Scan engine:', error);
      return false;
    }
  }

  /**
   * Wysyła komendę Hub protocol do silnika
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
   * Analizuje pozycję warcabową używając Hub protocol
   */
  async analyzePosition(position: string, options: DraughtsAnalysisOptions = {}): Promise<void> {
    const { depth = 15, movetime, variant = this.currentVariant } = options;

    // Inicjalizacja Hub protocol
    await this.sendCommand('hub');
    
    // Czekaj na odpowiedź initialization
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Inicjalizuj silnik
    await this.sendCommand('init');
    
    // Czekaj na "ready"
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Ustaw wariant jeśli różny
    if (variant !== this.currentVariant) {
      await this.sendCommand(`set-param name=variant value=${variant}`);
      this.currentVariant = variant;
    }

    // Ustaw pozycję
    await this.sendCommand(`pos pos=${position}`);
    
    // Ustaw poziom analizy
    let levelCommand = `level depth=${depth}`;
    if (movetime) levelCommand += ` move-time=${movetime}`;
    await this.sendCommand(levelCommand);
    
    // Rozpocznij analizę
    await this.sendCommand('go analyze=true');
  }

  /**
   * Pobiera najlepszy ruch dla pozycji
   */
  async getBestMove(position: string, options: DraughtsAnalysisOptions = {}): Promise<void> {
    const { depth = 12, movetime = 1000, variant = this.currentVariant } = options;

    await this.sendCommand('hub');
    await new Promise(resolve => setTimeout(resolve, 100));
    
    await this.sendCommand('init');
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (variant !== this.currentVariant) {
      await this.sendCommand(`set-param name=variant value=${variant}`);
      this.currentVariant = variant;
    }

    await this.sendCommand(`pos pos=${position}`);
    await this.sendCommand(`level depth=${depth} move-time=${movetime}`);
    await this.sendCommand('go think=true');
  }

  /**
   * Konwertuje pozycję z obiektu na string format
   */
  positionToString(position: DraughtsPosition): string {
    const { white, black, whiteKings, blackKings, sideToMove } = position;
    
    const side = sideToMove === 'white' ? 'W' : 'B';
    const whiteStr = white.length > 0 ? `W${white.join(',')}` : '';
    const blackStr = black.length > 0 ? `B${black.join(',')}` : '';
    const whiteKingsStr = whiteKings.length > 0 ? `K${whiteKings.join(',')}` : '';
    const blackKingsStr = blackKings.length > 0 ? `K${blackKings.join(',')}` : '';
    
    const parts = [whiteStr, blackStr, whiteKingsStr, blackKingsStr].filter(p => p);
    return `${side}:${parts.join(':')}`;
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
        white = part.substring(1).split(',').map(n => parseInt(n));
      } else if (part.startsWith('B')) {
        black = part.substring(1).split(',').map(n => parseInt(n));
      } else if (part.startsWith('K')) {
        // Kings - trzeba rozróżnić kolory na podstawie pozycji
        const kings = part.substring(1).split(',').map(n => parseInt(n));
        kings.forEach(king => {
          if (white.includes(king)) {
            whiteKings.push(king);
          } else if (black.includes(king)) {
            blackKings.push(king);
          }
        });
      }
    }
    
    return { white, black, whiteKings, blackKings, sideToMove };
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
    const subscription = ScanEventEmitter.addListener('scan-analyzed-output', listener);
    return () => subscription.remove();
  }

  /**
   * Zatrzymuje silnik
   */
  async shutdown(): Promise<boolean> {
    if (!this.engineInitialized) {
      return true;
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
}

export default new Scan();
export { Scan };