#import "RNScanModule.h"
#import <React/RCTLog.h>
#import <React/RCTUtils.h>
#import <pthread.h>

#include "scan_bridge.h"

@implementation RNScanModule {
    pthread_t engineThread;
    pthread_t listenerThread;
    BOOL engineRunning;
    BOOL listenerRunning;
    BOOL engineInitialized;
    dispatch_queue_t backgroundQueue;
    NSString *currentVariant;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[@"scan-output", @"scan-analyzed-output", @"scan-error", @"scan-ready"];
}

- (instancetype)init {
    self = [super init];
    if (self) {
        engineRunning = NO;
        listenerRunning = NO;
        engineInitialized = NO;
        currentVariant = @"normal";
        backgroundQueue = dispatch_queue_create("com.scan.background", DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

- (void)dealloc {
    [self shutdownEngineInternal];
}

void *scanEngineThreadFunction(void *arg) {
    @autoreleasepool {
        RNScanModule *module = (__bridge RNScanModule *)arg;
        
        @try {
            int result = scan_main();
            
            dispatch_async(dispatch_get_main_queue(), ^{
                if (result != 0) {
                    [module sendEventWithName:@"scan-error" 
                                         body:@{@"error": @"Engine execution failed", @"code": @(result)}];
                } else {
                    [module sendEventWithName:@"scan-ready" body:@{@"status": @"engine_stopped"}];
                }
                module->engineRunning = NO;
            });
        }
        @catch (NSException *exception) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [module sendEventWithName:@"scan-error" 
                                     body:@{@"error": exception.reason ?: @"Unknown engine error"}];
                module->engineRunning = NO;
            });
        }
    }
    return NULL;
}

void *scanListenerThreadFunction(void *arg) {
    @autoreleasepool {
        RNScanModule *module = (__bridge RNScanModule *)arg;
        
        // Poczekaj na inicjalizację silnika
        NSDate *timeout = [NSDate dateWithTimeIntervalSinceNow:5.0];
        while (!module->engineRunning && [timeout timeIntervalSinceNow] > 0) {
            [NSThread sleepForTimeInterval:0.1];
        }
        
        if (!module->engineRunning) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [module sendEventWithName:@"scan-error" 
                                     body:@{@"error": @"Engine failed to start within timeout"}];
            });
            return NULL;
        }
        
        // Główna pętla nasłuchiwania
        while (module->listenerRunning && module->engineRunning) {
            @autoreleasepool {
                @try {
                    const char *output = scan_stdout_read();
                    if (output != NULL && strlen(output) > 0) {
                        NSString *outputString = [NSString stringWithUTF8String:output];
                        if (outputString && outputString.length > 0) {
                            dispatch_async(dispatch_get_main_queue(), ^{
                                [module processEngineOutput:outputString];
                            });
                        }
                    }
                }
                @catch (NSException *exception) {
                    dispatch_async(dispatch_get_main_queue(), ^{
                        [module sendEventWithName:@"scan-error" 
                                             body:@{@"error": [NSString stringWithFormat:@"Listener error: %@", exception.reason]}];
                    });
                    break;
                }
                
                [NSThread sleepForTimeInterval:0.05]; // 50ms interval
            }
        }
        
        module->listenerRunning = NO;
    }
    return NULL;
}

- (void)processEngineOutput:(NSString *)output {
    if (!output || output.length == 0) return;
    
    @try {
        // Wyślij surowe wyjście
        [self sendEventWithName:@"scan-output" body:output];
        
        // Przetwórz linie
        NSArray *lines = [output componentsSeparatedByString:@"\n"];
        for (NSString *line in lines) {
            NSString *trimmedLine = [line stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (trimmedLine.length == 0) continue;
            
            if ([trimmedLine hasPrefix:@"done"]) {
                [self processDoneOutput:trimmedLine];
            } else if ([trimmedLine hasPrefix:@"info"]) {
                [self processInfoOutput:trimmedLine];
            } else if ([trimmedLine hasPrefix:@"ready"]) {
                [self sendEventWithName:@"scan-ready" body:@{@"status": @"ready"}];
            } else if ([trimmedLine hasPrefix:@"wait"]) {
                [self sendEventWithName:@"scan-ready" body:@{@"status": @"waiting"}];
            } else if ([trimmedLine hasPrefix:@"error"]) {
                [self processErrorOutput:trimmedLine];
            }
        }
    }
    @catch (NSException *exception) {
        [self sendEventWithName:@"scan-error" 
                           body:@{@"error": [NSString stringWithFormat:@"Output processing error: %@", exception.reason]}];
    }
}

- (void)processDoneOutput:(NSString *)line {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"done";
    
    // Parse parametry z linii "done move=... ponder=..."
    NSArray *parts = [line componentsSeparatedByString:@" "];
    for (NSInteger i = 0; i < parts.count; i++) {
        NSString *part = parts[i];
        NSArray *keyValue = [part componentsSeparatedByString:@"="];
        if (keyValue.count == 2) {
            NSString *key = keyValue[0];
            NSString *value = keyValue[1];
            result[key] = value;
        }
    }
    
    [self sendEventWithName:@"scan-analyzed-output" body:result];
}

- (void)processInfoOutput:(NSString *)line {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"info";
    result[@"line"] = line;
    
    // Parse dodatkowe informacje z linii info
    NSArray *parts = [line componentsSeparatedByString:@" "];
    for (NSInteger i = 1; i < parts.count; i++) { // Skip "info"
        NSString *part = parts[i];
        NSArray *keyValue = [part componentsSeparatedByString:@"="];
        if (keyValue.count == 2) {
            NSString *key = keyValue[0];
            NSString *value = keyValue[1];
            
            // Konwertuj wartości numeryczne
            if ([key isEqualToString:@"depth"] || [key isEqualToString:@"nodes"]) {
                result[key] = @([value integerValue]);
            } else if ([key isEqualToString:@"score"] || [key isEqualToString:@"time"]) {
                result[key] = @([value doubleValue]);
            } else {
                result[key] = value;
            }
        }
    }
    
    [self sendEventWithName:@"scan-analyzed-output" body:result];
}

- (void)processErrorOutput:(NSString *)line {
    [self sendEventWithName:@"scan-error" 
                       body:@{@"error": line, @"source": @"engine"}];
}

- (BOOL)isListenerRunning {
    return listenerRunning;
}

RCT_EXPORT_METHOD(initEngine:(NSString *)variant
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    dispatch_async(backgroundQueue, ^{
        @try {
            if (self->engineInitialized) {
                resolve(@(YES));
                return;
            }
            
            // Inicjalizuj silnik
            int initResult = scan_init();
            if (initResult != 0) {
                reject(@"INIT_ERROR", @"Failed to initialize Scan engine", nil);
                return;
            }
            
            // Ustaw wariant jeśli podany
            if (variant && variant.length > 0) {
                self->currentVariant = variant;
                scan_set_variant([variant UTF8String]);
            }
            
            // Uruchom wątek silnika
            int engineStatus = pthread_create(&self->engineThread, NULL, scanEngineThreadFunction, (__bridge void *)self);
            if (engineStatus != 0) {
                NSString *errorMsg = [NSString stringWithFormat:@"Failed to create engine thread: %d", engineStatus];
                reject(@"THREAD_ERROR", errorMsg, nil);
                return;
            }
            
            self->engineRunning = YES;
            
            // Poczekaj chwilę na uruchomienie silnika
            [NSThread sleepForTimeInterval:0.3];
            
            // Uruchom listener thread
            self->listenerRunning = YES;
            int listenerStatus = pthread_create(&self->listenerThread, NULL, scanListenerThreadFunction, (__bridge void *)self);
            if (listenerStatus != 0) {
                self->listenerRunning = NO;
                self->engineRunning = NO;
                NSString *errorMsg = [NSString stringWithFormat:@"Failed to create listener thread: %d", listenerStatus];
                reject(@"THREAD_ERROR", errorMsg, nil);
                return;
            }
            
            self->engineInitialized = YES;
            
            dispatch_async(dispatch_get_main_queue(), ^{
                [self sendEventWithName:@"scan-ready" body:@{@"status": @"initialized", @"variant": self->currentVariant}];
                resolve(@(YES));
            });
        }
        @catch (NSException *exception) {
            reject(@"EXCEPTION", exception.reason ?: @"Unknown error during initialization", nil);
        }
    });
}

RCT_EXPORT_METHOD(sendCommand:(NSString *)command
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    if (!engineInitialized || !engineRunning) {
        reject(@"ENGINE_NOT_RUNNING", @"Scan engine is not running", nil);
        return;
    }
    
    if (!command || command.length == 0) {
        reject(@"INVALID_COMMAND", @"Command cannot be empty", nil);
        return;
    }
    
    dispatch_async(backgroundQueue, ^{
        @try {
            const char *cmd = [command UTF8String];
            int success = scan_stdin_write(cmd);
            
            dispatch_async(dispatch_get_main_queue(), ^{
                resolve(@(success));
            });
        }
        @catch (NSException *exception) {
            reject(@"COMMAND_ERROR", exception.reason ?: @"Failed to send command", nil);
        }
    });
}

RCT_EXPORT_METHOD(setVariant:(NSString *)variant
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    if (!variant || variant.length == 0) {
        reject(@"INVALID_VARIANT", @"Variant cannot be empty", nil);
        return;
    }
    
    dispatch_async(backgroundQueue, ^{
        @try {
            int success = scan_set_variant([variant UTF8String]);
            if (success) {
                self->currentVariant = variant;
            }
            
            dispatch_async(dispatch_get_main_queue(), ^{
                resolve(@(success));
            });
        }
        @catch (NSException *exception) {
            reject(@"VARIANT_ERROR", exception.reason ?: @"Failed to set variant", nil);
        }
    });
}

RCT_EXPORT_METHOD(getPositionFormat:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    @try {
        const char *format = scan_get_position_format();
        NSString *formatString = format ? [NSString stringWithUTF8String:format] : @"";
        resolve(formatString);
    }
    @catch (NSException *exception) {
        reject(@"FORMAT_ERROR", exception.reason ?: @"Failed to get position format", nil);
    }
}

RCT_EXPORT_METHOD(shutdownEngine:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    dispatch_async(backgroundQueue, ^{
        @try {
            [self shutdownEngineInternal];
            
            dispatch_async(dispatch_get_main_queue(), ^{
                resolve(@(YES));
            });
        }
        @catch (NSException *exception) {
            reject(@"SHUTDOWN_ERROR", exception.reason ?: @"Failed to shutdown engine", nil);
        }
    });
}

- (void)shutdownEngineInternal {
    if (!engineInitialized) {
        return;
    }
    
    // Wyślij komendę quit
    if (engineRunning) {
        scan_stdin_write("quit");
        [NSThread sleepForTimeInterval:0.1]; // Give time for command to process
    }
    
    // Zatrzymaj listener
    listenerRunning = NO;
    
    // Zatrzymaj engine
    engineRunning = NO;
    
    // Poczekaj na zakończenie wątków
    if (listenerRunning) {
        pthread_join(listenerThread, NULL);
    }
    
    if (engineRunning) {
        pthread_join(engineThread, NULL);
    }
    
    engineInitialized = NO;
    
    [self sendEventWithName:@"scan-ready" body:@{@"status": @"shutdown"}];
}

@end