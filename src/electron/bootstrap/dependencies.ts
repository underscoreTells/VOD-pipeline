import { detectAudiowaveform } from '../audiowaveformDetector.js';
import { detectFFmpeg } from '../ffmpegDetector.js';
import { detectPython } from '../pythonDetector.js';
import { createLogger } from '../logger.js';
import { getWhisperRuntimeStatus } from '../../pipeline/whisper.js';

const logger = createLogger('Dependencies');

export async function initializeDependencies(): Promise<void> {
  await initializeFFmpeg();
  await initializeAudiowaveform();
  await initializePython();
}

async function initializeFFmpeg(): Promise<void> {
  logger.info('Initializing FFmpeg...');

  try {
    const result = await detectFFmpeg();
    if (result) {
      logger.info(`FFmpeg found: ${result.path}`);
      logger.info(`FFmpeg version: ${result.version}`);
      logger.info(`FFmpeg source: ${result.source}`);
      return;
    }

    logger.warn('FFmpeg not found. Video processing features will be disabled.');
    logger.warn('Install FFmpeg or run: pnpm postinstall');
  } catch (error) {
    logger.error('FFmpeg detection failed:', error);
    logger.warn('FFmpeg not found. Video processing features will be disabled.');
    logger.warn('Install FFmpeg or run: pnpm postinstall');
  }
}

async function initializeAudiowaveform(): Promise<void> {
  logger.info('Initializing audiowaveform...');

  try {
    const result = await detectAudiowaveform();
    if (result) {
      logger.info(`Audiowaveform found: ${result.path}`);
      logger.info(`Audiowaveform version: ${result.version}`);
      logger.info(`Audiowaveform source: ${result.source}`);
      return;
    }

    logger.warn('Audiowaveform not found. Waveform visualization will be disabled.');
    logger.warn('Install audiowaveform for waveform generation.');
  } catch (error) {
    logger.error('Audiowaveform detection failed:', error);
    logger.warn('Waveform visualization will be disabled.');
  }
}

async function initializePython(): Promise<void> {
  logger.info('Initializing Python...');

  try {
    const result = await detectPython();
    if (result) {
      logger.info(`Python found: ${result.path}`);
      logger.info(`Python version: ${result.version}`);
      logger.info(`Python source: ${result.source}`);

      void getWhisperRuntimeStatus({ autoSetup: true })
        .then((status) => {
          if (status.available) {
            logger.info(`Whisper runtime ready: ${status.pythonPath || 'unknown python'}`);
            return;
          }

          logger.warn('Whisper runtime unavailable after setup attempt:', status.error || 'unknown reason');
        })
        .catch((setupError) => {
          logger.warn('Whisper runtime setup check failed:', setupError);
        });
      return;
    }

    logger.warn('Python not found. Transcription features will be disabled.');
    logger.warn('Install Python 3.8+ to enable transcription.');
  } catch (error) {
    logger.error('Python detection failed:', error);
    logger.warn('Python not found. Transcription features will be disabled.');
    logger.warn('Install Python 3.8+ to enable transcription.');
  }
}
