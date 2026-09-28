export function buildBootstrapRootWranglerCommand(input: {
  environment: 'local' | 'staging';
  sqlFile: string;
  localConfig?: string;
  localPersistTo?: string;
}): {
  command: string;
  arguments: string[];
};
