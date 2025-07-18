//
//  RNScanModule.h
//  dawikk-scan
//
//  React Native bridge for the Scan draughts engine
//  Provides integration with the real Scan 3.1 engine by Fabien Letouzey
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
 * This module bridges the powerful Scan engine (version 3.1) by Fabien Letouzey
 * with React Native applications, enabling real-time draughts analysis, game play,
 * and position evaluation.
 *
 * Key Features:
 * - Full HUB protocol support
 * - Real-time analysis and move generation
 * - Multiple draughts variants (Normal, Killer, BT, Frisian, Losing)
 * - Opening book support
 * - Endgame database integration
 * - Multi-threaded search
 *
 * Events Emitted:
 * - 'scan-output': Raw output from the Scan engine
 * - 'scan-analyzed-output': Parsed analysis data including moves, scores, and engine info
 *
 * The module runs the Scan engine in a separate thread and communicates through
 * pipes to ensure non-blocking operation with the React Native JavaScript thread.
 */
@interface RNScanModule : RCTEventEmitter <RCTBridgeModule>

#pragma mark - Public Properties

/**
 * Indicates whether the Scan engine is currently running.
 * @note This property is thread-safe and can be accessed from any thread.
 */
@property (nonatomic, readonly, getter=isEngineRunning) BOOL engineRunning;

/**
 * Indicates whether the output listener thread is active.
 * @note This property is thread-safe and can be accessed from any thread.
 */
@property (nonatomic, readonly, getter=isListenerRunning) BOOL listenerRunning;

/**
 * Path to the Scan engine data files (books, evaluation, bitbases).
 * @note This is set during initialization and points to the ScanData bundle.
 */
@property (nonatomic, readonly, nullable) NSString *dataPath;

#pragma mark - Engine Lifecycle (Exported to React Native)

/**
 * Initializes the Scan engine and starts background threads.
 * @param resolve Promise resolver - called with @(YES) on success
 * @param reject Promise rejecter - called with error details on failure
 * 
 * This method:
 * 1. Sets up the data path to the ScanData bundle
 * 2. Initializes the C++ bridge
 * 3. Starts the engine thread running the HUB protocol
 * 4. Starts the output listener thread
 */
- (void)initEngine:(RCTPromiseResolveBlock)resolve
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
 * Shuts down the Scan engine and cleans up resources.
 * @param resolve Promise resolver - called with @(YES) on successful shutdown
 * @param reject Promise rejecter - called with error details on failure
 *
 * This method:
 * 1. Sends quit command to the engine
 * 2. Stops all background threads
 * 3. Cleans up the C++ bridge
 * 4. Releases all resources
 */
- (void)shutdownEngine:(RCTPromiseResolveBlock)resolve
              rejecter:(RCTPromiseRejectBlock)reject;

#pragma mark - Public Methods (Available to Native Code)

/**
 * Sets up the data path for Scan engine files.
 * This method locates the ScanData bundle and sets the working directory.
 * Called automatically during initialization.
 */
- (void)setupDataPath;

/**
 * Processes raw output from the Scan engine and emits appropriate React Native events.
 * @param output Raw output string from the engine
 *
 * This method:
 * 1. Parses the HUB protocol output
 * 2. Emits 'scan-output' events with raw data
 * 3. Emits 'scan-analyzed-output' events with parsed data
 */
- (void)processEngineOutput:(NSString *)output;

#pragma mark - Output Processing Methods

/**
 * Processes and emits engine identification information.
 * @param line HUB 'id' command response
 */
- (void)sendEngineInfo:(NSString *)line;

/**
 * Processes and emits engine parameter information.
 * @param line HUB 'param' command response  
 */
- (void)sendParameterInfo:(NSString *)line;

/**
 * Processes and emits best move information.
 * @param line HUB 'done' command response with move data
 */
- (void)sendBestMoveOutput:(NSString *)line;

/**
 * Processes and emits analysis information.
 * @param line HUB 'info' command response with analysis data
 */
- (void)sendAnalyzedOutput:(NSString *)line;

/**
 * Parses HUB protocol key=value pairs into a dictionary.
 * @param line HUB protocol line to parse
 * @param dict Mutable dictionary to populate with parsed data
 *
 * Handles quoted values and multiple word values correctly.
 */
- (void)parseHubLine:(NSString *)line intoDictionary:(NSMutableDictionary *)dict;

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

/**
 * Standard starting position for international draughts
 */
FOUNDATION_EXPORT NSString * const kScanStartingPosition;

NS_ASSUME_NONNULL_END