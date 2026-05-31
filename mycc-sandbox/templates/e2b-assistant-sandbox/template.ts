import { Template } from 'e2b';

export const defaultTemplateName = 'mycc-assistant-sandbox-dev';

export const template = Template()
  .fromDockerfile('./Dockerfile')
  .setUser('mycc')
  .setWorkdir('/home/mycc/workspace')
  .setReadyCmd('/opt/mycc/contracts/template-contract.sh --ready');
