export function buildBootstrapRootWranglerCommand(input: {
  environment: 'local' | 'staging';
  sqlFile: string;
}): {
  command: string;
  arguments: string[];
};
