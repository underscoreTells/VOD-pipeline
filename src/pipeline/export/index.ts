export { generateFCPXML, type FCPXMLOptions } from './xml';
export { generateJSON, type JSONExportOptions, type JSONExportData } from './json';
export { generateEDL, type EDLOptions } from './edl';

export type ExportFormat = 'fcpxml' | 'json' | 'edl';

export const EXPORT_FORMATS: Array<{ value: ExportFormat; label: string; extension: string; description: string }> = [
  {
    value: 'fcpxml',
    label: 'FCPXML (Final Cut Pro)',
    extension: '.fcpxml',
    description: 'Compatible with Final Cut Pro X and DaVinci Resolve',
  },
  {
    value: 'json',
    label: 'JSON',
    extension: '.json',
    description: 'Internal format for backup and debugging',
  },
  {
    value: 'edl',
    label: 'EDL (Edit Decision List)',
    extension: '.edl',
    description: 'CMX 3600 format for legacy NLE compatibility',
  },
];
