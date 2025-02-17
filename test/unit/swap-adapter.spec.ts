import chai, { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, constants, utils, Wallet } from 'ethers';
import { behaviours, wallet } from '@utils';
import { given, then, when } from '@utils/bdd';
import { IERC20, ISwapperRegistry, SwapAdapterMock, SwapAdapterMock__factory, Swapper, Swapper__factory } from '@typechained';
import { snapshot } from '@utils/evm';
import { FakeContract, MockContract, smock } from '@defi-wonderland/smock';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { TransactionResponse } from '@ethersproject/abstract-provider';

chai.use(smock.matchers);

describe('SwapAdapter', () => {
  const ACCOUNT = '0x0000000000000000000000000000000000000001';
  const AMOUNT = 1000000;

  let caller: SignerWithAddress;
  let swapAdapterFactory: SwapAdapterMock__factory;
  let swapAdapter: SwapAdapterMock;
  let swapper: MockContract<Swapper>;
  let registry: FakeContract<ISwapperRegistry>;
  let snapshotId: string;
  let token: FakeContract<IERC20>;

  before('Setup accounts and contracts', async () => {
    [caller] = await ethers.getSigners();
    registry = await smock.fake('ISwapperRegistry');
    const swapperFactory = await smock.mock<Swapper__factory>('Swapper');
    swapper = await swapperFactory.deploy();
    swapAdapterFactory = await ethers.getContractFactory('solidity/contracts/test/SwapAdapter.sol:SwapAdapterMock');
    swapAdapter = await swapAdapterFactory.deploy(registry.address);
    token = await smock.fake('IERC20');
    snapshotId = await snapshot.take();
  });

  beforeEach(async () => {
    await snapshot.revert(snapshotId);
    token.allowance.reset();
    token.approve.reset();
    token.balanceOf.reset();
    token.transfer.reset();
    token.transferFrom.reset();
    token.transfer.returns(true);
    token.transferFrom.returns(true);
    registry.isSwapperAllowlisted.reset();
    registry.isValidAllowanceTarget.reset();
    registry.isValidAllowanceTarget.returns(true);
  });

  describe('constructor', () => {
    when('registry is zero address', () => {
      then('tx is reverted with reason error', async () => {
        await behaviours.deployShouldRevertWithMessage({
          contract: swapAdapterFactory,
          args: [constants.AddressZero],
          message: 'ZeroAddress',
        });
      });
    });
    when('all arguments are valid', () => {
      then('registry is set correctly', async () => {
        expect(await swapAdapter.SWAPPER_REGISTRY()).to.equal(registry.address);
      });
      then('protocol token is set correctly', async () => {
        expect(await swapAdapter.PROTOCOL_TOKEN()).to.equal('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE');
      });
    });
  });

  describe('_revokeAllowances', () => {
    when('function is called', () => {
      given(async () => {
        await swapAdapter.internalRevokeAllowances([{ spender: ACCOUNT, tokens: [token.address] }]);
      });
      then('allowance is revoked', async () => {
        expect(token.approve).to.have.been.calledOnceWith(ACCOUNT, 0);
      });
    });
  });

  describe('_takeFromMsgSender', () => {
    when('function is called', () => {
      given(async () => {
        await swapAdapter.internalTakeFromMsgSender(token.address, AMOUNT);
      });
      then('token is called correctly', async () => {
        expect(token.transferFrom).to.have.been.calledOnceWith(caller.address, swapAdapter.address, AMOUNT);
      });
    });
  });

  describe('_maxApproveSpenderIfNeeded', () => {
    when('spender is the zero address', () => {
      given(async () => {
        await swapAdapter.internalMaxApproveSpenderIfNeeded(token.address, constants.AddressZero, false, AMOUNT);
      });
      then('allowance is not checked', () => {
        expect(token.allowance).to.not.have.been.called;
      });
      then('registry is not called', async () => {
        expect(registry.isValidAllowanceTarget).to.not.have.been.called;
      });
      then('approve is not called', async () => {
        expect(token.approve).to.not.have.been.called;
      });
    });
    when('current allowance is enough', () => {
      given(async () => {
        token.allowance.returns(AMOUNT);
        await swapAdapter.internalMaxApproveSpenderIfNeeded(token.address, ACCOUNT, false, AMOUNT);
      });
      then('allowance is checked correctly', () => {
        expect(token.allowance).to.have.been.calledOnceWith(swapAdapter.address, ACCOUNT);
      });
      then('registry is not called', async () => {
        expect(registry.isValidAllowanceTarget).to.not.have.been.called;
      });
      then('approve is not called', async () => {
        expect(token.approve).to.not.have.been.called;
      });
    });
    when('current allowance is not enough and the registry says that the target is invalid', () => {
      given(() => {
        token.allowance.returns(AMOUNT - 1);
        registry.isValidAllowanceTarget.returns(false);
      });
      then('reverts with message', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: swapAdapter,
          func: 'internalMaxApproveSpenderIfNeeded',
          args: [token.address, ACCOUNT, false, AMOUNT],
          message: 'InvalidAllowanceTarget',
        });
      });
    });
    when('the registry says that the target is invalid but the spender had already been validated', () => {
      given(async () => {
        token.allowance.returns(AMOUNT - 1);
        registry.isValidAllowanceTarget.returns(false);
        await swapAdapter.internalMaxApproveSpenderIfNeeded(token.address, ACCOUNT, true, AMOUNT);
      });
      then('registry is not called', async () => {
        expect(registry.isValidAllowanceTarget).to.not.have.been.called;
      });
      then('allowance is checked correctly', () => {
        expect(token.allowance).to.have.been.calledOnceWith(swapAdapter.address, ACCOUNT);
      });
      then('approve is called twice', async () => {
        expect(token.approve).to.have.been.calledTwice;
        expect(token.approve).to.have.been.calledWith(ACCOUNT, 0);
        expect(token.approve).to.have.been.calledWith(ACCOUNT, constants.MaxUint256);
      });
    });
    when('current allowance is not enough but its not zero', () => {
      given(async () => {
        token.allowance.returns(AMOUNT - 1);
        await swapAdapter.internalMaxApproveSpenderIfNeeded(token.address, ACCOUNT, false, AMOUNT);
      });
      then('allowance is checked correctly', () => {
        expect(token.allowance).to.have.been.calledOnceWith(swapAdapter.address, ACCOUNT);
      });
      then('approve is called twice', async () => {
        expect(token.approve).to.have.been.calledTwice;
        expect(token.approve).to.have.been.calledWith(ACCOUNT, 0);
        expect(token.approve).to.have.been.calledWith(ACCOUNT, constants.MaxUint256);
      });
      then('registry is called correctly', async () => {
        expect(registry.isValidAllowanceTarget).to.have.been.calledOnceWith(ACCOUNT);
      });
    });
    when('current allowance is zero', () => {
      given(async () => {
        token.allowance.returns(0);
        await swapAdapter.internalMaxApproveSpenderIfNeeded(token.address, ACCOUNT, false, AMOUNT);
      });
      then('allowance is checked correctly', () => {
        expect(token.allowance).to.have.been.calledOnceWith(swapAdapter.address, ACCOUNT);
      });
      then('approve is called once', async () => {
        expect(token.approve).to.have.been.calledOnceWith(ACCOUNT, constants.MaxUint256);
      });
    });
  });

  describe('_executeSwap', () => {
    const VALUE = 123456;
    when('executing a swap', () => {
      given(async () => {
        const { data } = await swapper.populateTransaction.executeSwap(ACCOUNT, ACCOUNT, AMOUNT);
        await swapAdapter.internalExecuteSwap(swapper.address, data!, VALUE, { value: VALUE });
      });
      then('swapper is called correctly', () => {
        expect(swapper.executeSwap).to.have.been.calledOnceWith(ACCOUNT, ACCOUNT, AMOUNT);
      });
      then('swapper was sent the ether correctly', async () => {
        expect(await swapper.msgValue()).to.equal(VALUE);
      });
    });
    when('sending less value than specified', () => {
      let tx: Promise<TransactionResponse>;
      given(async () => {
        const { data } = await swapper.populateTransaction.executeSwap(ACCOUNT, ACCOUNT, AMOUNT);
        tx = swapAdapter.internalExecuteSwap(swapper.address, data!, VALUE, { value: VALUE - 1 });
      });
      then('tx reverts', async () => {
        await expect(tx).to.have.reverted;
      });
    });
  });

  describe('_sendBalanceOnContractToRecipient', () => {
    describe('ERC20', () => {
      when('there is no balance', () => {
        given(async () => {
          token.balanceOf.returns(0);
          await swapAdapter.internalSendBalanceOnContractToRecipient(token.address, ACCOUNT);
        });
        then('balance is checked correctly', () => {
          expect(token.balanceOf).to.have.been.calledOnceWith(swapAdapter.address);
        });
        then('transfer is not executed', async () => {
          expect(token.transfer).to.not.have.been.called;
        });
      });
      when('there is some balance', () => {
        given(async () => {
          token.balanceOf.returns(AMOUNT);
          await swapAdapter.internalSendBalanceOnContractToRecipient(token.address, ACCOUNT);
        });
        then('balance is checked correctly', () => {
          expect(token.balanceOf).to.have.been.calledOnceWith(swapAdapter.address);
        });
        then('transfer is executed', async () => {
          expect(token.transfer).to.have.been.calledOnceWith(ACCOUNT, AMOUNT);
        });
      });
      when('recipient is zero address', () => {
        given(async () => {
          token.balanceOf.returns(AMOUNT);
          await swapAdapter.internalSendBalanceOnContractToRecipient(token.address, constants.AddressZero);
        });
        then('balance is checked correctly', () => {
          expect(token.balanceOf).to.have.been.calledOnceWith(swapAdapter.address);
        });
        then('balance is transferred to the caller', async () => {
          expect(token.transfer).to.have.been.calledOnceWith(caller.address, AMOUNT);
        });
      });
    });
    describe('Protocol token', () => {
      const RECIPIENT = Wallet.createRandom();
      when('there is no balance', () => {
        given(async () => {
          await swapAdapter.internalSendBalanceOnContractToRecipient(token.address, RECIPIENT.address);
        });
        then('nothing is sent', async () => {
          expect(await ethers.provider.getBalance(RECIPIENT.address)).to.equal(0);
        });
      });
      when('there is some balance', () => {
        const BALANCE = BigNumber.from(12345);
        given(async () => {
          await wallet.setBalance({ account: swapAdapter.address, balance: BALANCE });
          await swapAdapter.internalSendBalanceOnContractToRecipient('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', RECIPIENT.address);
        });
        then('adapter no longer has balance', async () => {
          expect(await ethers.provider.getBalance(swapAdapter.address)).to.equal(0);
        });
        then('balance is transferred to recipient', async () => {
          expect(await ethers.provider.getBalance(RECIPIENT.address)).to.equal(BALANCE);
        });
      });
      when('recipient is zero address', () => {
        const BALANCE = BigNumber.from(12345);
        let gasSpent: BigNumber, initialBalance: BigNumber;
        given(async () => {
          initialBalance = await ethers.provider.getBalance(caller.address);
          await wallet.setBalance({ account: swapAdapter.address, balance: BALANCE });
          const tx = await swapAdapter.internalSendBalanceOnContractToRecipient(
            '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            constants.AddressZero
          );
          const receipt = await tx.wait();
          gasSpent = receipt.gasUsed.mul(receipt.effectiveGasPrice);
        });
        then('adapter no longer has balance', async () => {
          expect(await ethers.provider.getBalance(swapAdapter.address)).to.equal(0);
        });
        then('balance is transferred to the caller', async () => {
          expect(await ethers.provider.getBalance(caller.address)).to.equal(initialBalance.sub(gasSpent).add(BALANCE));
        });
      });
    });
  });

  describe('_sendToRecipient', () => {
    const RECIPIENT = Wallet.createRandom();
    when('sending ERC20 tokens to the recipient', () => {
      given(async () => {
        await swapAdapter.internalSendToRecipient(token.address, AMOUNT, RECIPIENT.address);
      });
      then('transfer is executed', async () => {
        expect(token.transfer).to.have.been.calledOnceWith(RECIPIENT.address, AMOUNT);
      });
    });
    when('sending ERC20 tokens to the zero address', () => {
      given(async () => {
        await swapAdapter.internalSendToRecipient(token.address, AMOUNT, constants.AddressZero);
      });
      then('amount is transferred to the caller', async () => {
        expect(token.transfer).to.have.been.calledOnceWith(caller.address, AMOUNT);
      });
    });
    when('sending ETH to the recipient', () => {
      given(async () => {
        await wallet.setBalance({ account: swapAdapter.address, balance: BigNumber.from(AMOUNT) });
        await swapAdapter.internalSendToRecipient(await swapAdapter.PROTOCOL_TOKEN(), AMOUNT, RECIPIENT.address);
      });
      then('adapter no longer has balance', async () => {
        expect(await ethers.provider.getBalance(swapAdapter.address)).to.equal(0);
      });
      then('amount is transferred to recipient', async () => {
        expect(await ethers.provider.getBalance(RECIPIENT.address)).to.equal(AMOUNT);
      });
    });
    when('sending ETH to the zero address', () => {
      let gasSpent: BigNumber, initialBalance: BigNumber;
      given(async () => {
        initialBalance = await ethers.provider.getBalance(caller.address);
        await wallet.setBalance({ account: swapAdapter.address, balance: BigNumber.from(AMOUNT) });
        const tx = await swapAdapter.internalSendToRecipient(await swapAdapter.PROTOCOL_TOKEN(), AMOUNT, constants.AddressZero);
        const receipt = await tx.wait();
        gasSpent = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      });
      then('adapter no longer has balance', async () => {
        expect(await ethers.provider.getBalance(swapAdapter.address)).to.equal(0);
      });
      then('amount is transferred to the caller', async () => {
        expect(await ethers.provider.getBalance(caller.address)).to.equal(initialBalance.sub(gasSpent).add(AMOUNT));
      });
    });
  });

  describe('_assertSwapperIsAllowlisted', () => {
    when('swapper is allowlisted', () => {
      given(async () => {
        registry.isSwapperAllowlisted.returns(true);
        await swapAdapter.internalAssertSwapperIsAllowlisted(ACCOUNT);
      });
      then('allowlist is checked correctly', () => {
        expect(registry.isSwapperAllowlisted).to.have.been.calledOnceWith(ACCOUNT);
      });
    });
    when('swapper is not allowlisted', () => {
      given(() => {
        registry.isSwapperAllowlisted.returns(false);
      });
      then('reverts with message', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: swapAdapter,
          func: 'internalAssertSwapperIsAllowlisted',
          args: [ACCOUNT],
          message: 'SwapperNotAllowlisted',
        });
      });
    });
  });
});
