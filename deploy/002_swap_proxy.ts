import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { bytecode } from '../artifacts/solidity/contracts/SwapProxy.sol/SwapProxy.json';
import { deployThroughDeterministicFactory } from '@mean-finance/deterministic-factory/utils/deployment';
import { DeployFunction } from '@0xged/hardhat-deploy/dist/types';

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer, governor } = await hre.getNamedAccounts();

  const registry = await hre.deployments.get('SwapperRegistry');

  await deployThroughDeterministicFactory({
    deployer,
    name: 'SwapProxy',
    salt: 'MF-Swap-Proxy-V1',
    contract: 'solidity/contracts/SwapProxy.sol:SwapProxy',
    bytecode,
    constructorArgs: {
      types: ['address', 'address'],
      values: [registry.address, governor],
    },
    log: !process.env.TEST,
    overrides: {
      gasLimit: 3_000_000,
    },
  });
};

deployFunction.dependencies = ['SwapperRegistry'];
deployFunction.tags = ['SwapProxy'];
export default deployFunction;
