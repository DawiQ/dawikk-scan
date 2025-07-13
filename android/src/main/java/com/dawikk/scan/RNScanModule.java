package com.dawikk.scan;

import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.util.HashMap;
import java.util.Map;

@ReactModule(name = "RNScanModule")
public class RNScanModule extends ReactContextBaseJavaModule {
    private static final String TAG = "RNScanModule";
    private static final String EVENT_SCAN_OUTPUT = "scan-output";
    private static final String EVENT_SCAN_ANALYZED_OUTPUT = "scan-analyzed-output";

    private final ReactApplicationContext reactContext;
    private boolean engineRunning = false;
    private boolean listenerRunning = false;
    private Thread engineThread;
    private Thread listenerThread;

    static {
        System.loadLibrary("scan-lib");
    }

    // Native methods
    private native int nativeInit();
    private native int nativeMain();
    private native String nativeReadOutput();
    private native boolean nativeSendCommand(String command);
    private native boolean nativeSetVariant(String variant);

    public RNScanModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return "RNScanModule";
    }

    @Override
    public Map<String, Object> getConstants() {
        final Map<String, Object> constants = new HashMap<>();
        constants.put("SCAN_OUTPUT", EVENT_SCAN_OUTPUT);
        constants.put("SCAN_ANALYZED_OUTPUT", EVENT_SCAN_ANALYZED_OUTPUT);
        return constants;
    }

    @ReactMethod
    public void initEngine(String variant, Promise promise) {
        if (engineRunning) {
            promise.resolve(true);
            return;
        }

        try {
            int result = nativeInit();
            if (result != 0) {
                promise.reject("INIT_ERROR", "Failed to initialize Scan engine");
                return;
            }

            // Ustaw wariant warcabów
            if (variant != null && !variant.isEmpty()) {
                nativeSetVariant(variant);
            }

            // Uruchom wątek silnika
            engineThread = new Thread(() -> {
                try {
                    nativeMain();
                } catch (Exception e) {
                    Log.e(TAG, "Error in engine thread", e);
                }
            });
            engineThread.start();
            engineRunning = true;

            // Uruchom wątek nasłuchujący
            startListenerThread();

            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("INIT_ERROR", "Failed to initialize Scan engine: " + e.getMessage());
        }
    }

    private void startListenerThread() {
        listenerRunning = true;
        listenerThread = new Thread(() -> {
            try {
                while (listenerRunning) {
                    String output = nativeReadOutput();
                    if (output != null && !output.isEmpty()) {
                        processEngineOutput(output);
                    }
                    Thread.sleep(10);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in listener thread", e);
            }
        });
        listenerThread.start();
    }

    private void processEngineOutput(String output) {
        if (output == null || output.isEmpty()) return;

        String[] lines = output.split("\n");
        for (String line : lines) {
            if (line.isEmpty()) continue;

            // Wyślij surowe wyjście do JavaScript
            sendEvent(reactContext, EVENT_SCAN_OUTPUT, line);

            // Przetwórz wyjście analizy (Hub protocol)
            if (line.startsWith("done")) {
                processDoneOutput(line);
            } else if (line.startsWith("info")) {
                processInfoOutput(line);
            }
        }
    }

    private void processDoneOutput(String line) {
        WritableMap result = Arguments.createMap();
        result.putString("type", "done");
        
        // Parse Hub protocol done line: "done move=32-28 ponder=28-22"
        String[] parts = line.split(" ");
        for (String part : parts) {
            if (part.contains("=")) {
                String[] keyValue = part.split("=", 2);
                if (keyValue.length == 2) {
                    String key = keyValue[0];
                    String value = keyValue[1].replaceAll("\"", ""); // Usuń cudzysłowy
                    
                    if ("move".equals(key)) {
                        result.putString("move", value);
                    } else if ("ponder".equals(key)) {
                        result.putString("ponder", value);
                    }
                }
            }
        }

        sendEvent(reactContext, EVENT_SCAN_ANALYZED_OUTPUT, result);
    }

    private void processInfoOutput(String line) {
        // Hub protocol może mieć różne rodzaje info lines
        WritableMap result = Arguments.createMap();
        result.putString("type", "info");
        result.putString("line", line);
        
        // Parsuj parametry z Hub protocol
        String[] parts = line.split(" ");
        for (String part : parts) {
            if (part.contains("=")) {
                String[] keyValue = part.split("=", 2);
                if (keyValue.length == 2) {
                    String key = keyValue[0];
                    String value = keyValue[1].replaceAll("\"", "");
                    
                    try {
                        // Spróbuj sparsować wartości numeryczne
                        if ("depth".equals(key)) {
                            result.putInt("depth", Integer.parseInt(value));
                        } else if ("score".equals(key)) {
                            result.putDouble("score", Double.parseDouble(value));
                        } else {
                            result.putString(key, value);
                        }
                    } catch (NumberFormatException e) {
                        result.putString(key, value);
                    }
                }
            }
        }
        
        sendEvent(reactContext, EVENT_SCAN_ANALYZED_OUTPUT, result);
    }

    private void sendEvent(ReactContext reactContext, String eventName, @Nullable Object params) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit(eventName, params);
        }
    }

    @ReactMethod
    public void sendCommand(String command, Promise promise) {
        if (!engineRunning) {
            promise.reject("ENGINE_NOT_RUNNING", "Scan engine is not running");
            return;
        }

        try {
            boolean success = nativeSendCommand(command);
            promise.resolve(success);
        } catch (Exception e) {
            promise.reject("COMMAND_ERROR", "Error sending command: " + e.getMessage());
        }
    }

    @ReactMethod
    public void shutdownEngine(Promise promise) {
        if (!engineRunning) {
            promise.resolve(true);
            return;
        }

        try {
            nativeSendCommand("quit");
            
            listenerRunning = false;
            if (listenerThread != null) {
                listenerThread.join(1000);
            }

            if (engineThread != null) {
                engineThread.join(1000);
            }

            engineRunning = false;
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("SHUTDOWN_ERROR", "Error shutting down engine: " + e.getMessage());
        }
    }
}