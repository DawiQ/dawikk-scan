//
//  RNScanModule.h
//  dawikk-scan
//
//  Fixed React Native bridge for the Scan draughts engine
//  Provides safe integration with proper threading and error handling
//
//  Created by dawikk-scan
//  Copyright © 2024. All rights reserved.
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * RNScanModule provides React Native integration with the Scan draughts engine.
 * 
 * This module bridges the Scan engine (version 3.1) by Fabien Letouzey
 * with React Native applications using proper threading and error handling.
 *
 * Key Features:
 * - Thread-safe HUB protocol support
 * - Real-time analysis and move generation
 * - Multiple draughts variants (Normal, Killer, BT, Frisian, Losing)
 * - Opening book support
 * - Endgame database integration
 * - Proper error handling and recovery
 *
 * Events Emitted:
 * - 'scan-output': Raw output from the Scan engine
 * - 'scan-analyzed-output': Parsed analysis data including moves, scores, and engine info
 * - 'scan-error': Error messages from the engine or bridge
 * - 'scan-status': Engine status changes
 *
 * The module runs the Scan engine in a separate thread and communicates through
 * a thread-safe message queue to ensure stability with React Native.
 */
@interface RNScanModule : RCTEventEmitter <RCTBridgeModule>

#pragma mark - Public Properties

/**
 * Indicates whether the Scan engine is currently initialized.
 */
@property (nonatomic, readonly, getter=isEngineInitialized) BOOL engineInitialized;

/**
 * Indicates whether the Scan engine is ready to process commands.
 */
@property (nonatomic, readonly, getter=isEngineReady) BOOL engineReady;

/**
 * Current engine status as a string.
 */
@property (nonatomic, readonly) NSString *engineStatus;

/**
 * Last error message from the engine.
 */
@property (nonatomic, readonly, nullable) NSString *lastError;

/**
 * Path to the Scan engine data files.
 */
@property (nonatomic, readonly, nullable) NSString *dataPath;

#pragma mark - Engine Lifecycle (Exported to React Native)

/**
 * Initializes the Scan engine.
 * @param resolve Promise resolver - called with @(YES) on success
 * @param reject Promise rejecter - called with error details on failure
 * 
 * This method:
 * 1. Sets up the data path to the ScanData bundle
 * 2. Initializes the C++ bridge
 * 3. Sets up message callbacks
 */
- (void)initEngine:(RCTPromiseResolveBlock)resolve
          rejecter:(RCTPromiseRejectBlock)reject;

/**
 * Starts the Scan engine thread.
 * @param resolve Promise resolver - called with @(YES) on success
 * @param reject Promise rejecter - called with error details on failure
 */
- (void)startEngine:(RCTPromiseResolveBlock)resolve
           rejecter:(RCTPromiseRejectBlock)reject;

/**
 * Sends a HUB protocol command to the Scan engine.
 * @param command The HUB command string to send
 * @param resolve Promise resolver - called with @(YES) on successful send
 * @param reject Promise rejecter - called with error details on failure
 *
 * Common commands:
 * - "hub" - Initialize HUB protocol
 * - "init" - Initialize engine
 * - "pos pos=<position>" - Set position
 * - "go think" - Start thinking
 * - "go analyze" - Start analysis
 * - "stop" - Stop calculation
 * - "quit" - Quit engine
 */
- (void)sendCommand:(NSString *)command
           resolver:(RCTPromiseResolveBlock)resolve
           rejecter:(RCTPromiseRejectBlock)reject;

/**
 * Gets the current engine status.
 * @param resolve Promise resolver - called with status string
 * @param reject Promise rejecter - called with error details on failure
 */
- (void)getStatus:(RCTPromiseResolveBlock)resolve
         rejecter:(RCTPromiseRejectBlock)reject;

/**
 * Checks if the engine is ready to process commands.
 * @param resolve Promise resolver - called with @(YES) if ready
 * @param reject Promise rejecter - called with error details on failure
 */
- (void)isReady:(RCTPromiseResolveBlock)resolve
       rejecter:(RCTPromiseRejectBlock)reject;

/**
 * Waits for the engine to be ready with a timeout.
 * @param timeout Timeout in seconds
 * @param resolve Promise resolver - called with @(YES) if ready within timeout
 * @param reject Promise rejecter - called with error details on failure
 */
- (void)waitReady:(NSNumber *)timeout
         resolver:(RCTPromiseResolveBlock)resolve
         rejecter:(RCTPromiseRejectBlock)reject;

/**
 * Shuts down the Scan engine and cleans up resources.
 * @param resolve Promise resolver - called with @(YES) on successful shutdown
 * @param reject Promise rejecter - called with error details on failure
 */
- (void)shutdownEngine:(RCTPromiseResolveBlock)resolve
              rejecter:(RCTPromiseRejectBlock)reject;

#pragma mark - Convenience Methods (Exported to React Native)

/**
 * Analyzes a position with the given parameters.
 * @param position Position string in HUB format
 * @param options Analysis options dictionary (depth, time, etc.)
 * @param resolve Promise resolver - called with @(YES) when analysis starts
 * @param reject Promise rejecter - called with error details on failure
 */
- (void)analyzePosition:(NSString *)position
                options:(NSDictionary *)options
               resolver:(RCTPromiseResolveBlock)resolve
               rejecter:(RCTPromiseRejectBlock)reject;

/**
 * Gets the best move for a position.
 * @param position Position string in HUB format
 * @param options Search options dictionary (depth, time, etc.)
 * @param resolve Promise resolver - called with move string
 * @param reject Promise rejecter - called with error details on failure
 */
- (void)getBestMove:(NSString *)position
            options:(NSDictionary *)options
           resolver:(RCTPromiseResolveBlock)resolve
           rejecter:(RCTPromiseRejectBlock)reject;

/**
 * Stops the current analysis or search.
 * @param resolve Promise resolver - called with @(YES) on success
 * @param reject Promise rejecter - called with error details on failure
 */
- (void)stopAnalysis:(RCTPromiseResolveBlock)resolve
            rejecter:(RCTPromiseRejectBlock)reject;

/**
 * Sets engine parameters.
 * @param params Dictionary of parameter name-value pairs
 * @param resolve Promise resolver - called with @(YES) on success
 * @param reject Promise rejecter - called with error details on failure
 */
- (void)setParameters:(NSDictionary *)params
             resolver:(RCTPromiseResolveBlock)resolve
             rejecter:(RCTPromiseRejectBlock)reject;

#pragma mark - Internal Methods

/**
 * Sets up the data path for Scan engine files.
 */
- (void)setupDataPath;

/**
 * Processes a message from the engine.
 * @param message Message string from the engine
 */
- (void)processEngineMessage:(NSString *)message;

/**
 * Emits a status change event.
 * @param status New status string
 */
- (void)emitStatusChange:(NSString *)status;

/**
 * Emits an error event.
 * @param error Error message
 */
- (void)emitError:(NSString *)error;

@end

#pragma mark - Constants

/**
 * Supported draughts variants
 */
FOUNDATION_EXPORT NSString * const kScanVariantNormal;
FOUNDATION_EXPORT NSString * const kScanVariantKiller;
FOUNDATION_EXPORT NSString * const kScanVariantBT;
FOUNDATION_EXPORT NSString * const kScanVariantFrisian;
FOUNDATION_EXPORT NSString * const kScanVariantLosing;

/**
 * Event names emitted by this module
 */
FOUNDATION_EXPORT NSString * const kScanEventOutput;
FOUNDATION_EXPORT NSString * const kScanEventAnalyzedOutput;
FOUNDATION_EXPORT NSString * const kScanEventError;
FOUNDATION_EXPORT NSString * const kScanEventStatus;

/**
 * Engine status constants
 */
FOUNDATION_EXPORT NSString * const kScanStatusStopped;
FOUNDATION_EXPORT NSString * const kScanStatusInitializing;
FOUNDATION_EXPORT NSString * const kScanStatusReady;
FOUNDATION_EXPORT NSString * const kScanStatusThinking;
FOUNDATION_EXPORT NSString * const kScanStatusError;

/**
 * Standard starting position for international draughts
 */
FOUNDATION_EXPORT NSString * const kScanStartingPosition;

/**
 * Common error codes
 */
FOUNDATION_EXPORT NSString * const kScanErrorInitFailed;
FOUNDATION_EXPORT NSString * const kScanErrorNotInitialized;
FOUNDATION_EXPORT NSString * const kScanErrorAlreadyRunning;
FOUNDATION_EXPORT NSString * const kScanErrorInvalidCommand;
FOUNDATION_EXPORT NSString * const kScanErrorEngineError;
FOUNDATION_EXPORT NSString * const kScanErrorTimeout;

NS_ASSUME_NONNULL_END