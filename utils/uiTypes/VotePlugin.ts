import { GatewayClient } from '@solana/governance-program-library'
import {
  SwitchboardQueueVoterClient,
  SWITCHBOARD_ADDIN_ID,
} from '../../SwitchboardVotePlugin/SwitchboardQueueVoterClient'
import { PROGRAM_ID as ACCOUNT_COMPACTION_PROGRAM_ID } from '@solana/spl-account-compression'
import {
  ProgramAccount,
  Realm,
  SYSTEM_PROGRAM_ID,
  Proposal,
  TokenOwnerRecord,
} from '@solana/spl-governance'
import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { chunks } from '@utils/helpers'
import { PythClient } from 'pyth-staking-api'
import {
  getRegistrarPDA,
  getVoterPDA,
  getVoterWeightPDA,
} from 'VoteStakeRegistry/sdk/accounts'
import { NFTWithMint } from './nfts'
import {
  getPreviousVotingWeightRecord,
  getVoteInstruction,
} from '../../GatewayPlugin/sdk/accounts'
import {
  getVoterWeightRecord as getPluginVoterWeightRecord,
  getRegistrarPDA as getPluginRegistrarPDA,
  getMaxVoterWeightRecord as getPluginMaxVoterWeightRecord,
} from '@utils/plugin/accounts'
import { VsrClient } from 'VoteStakeRegistry/sdk/client'
import {
  getNftVoteRecordProgramAddress,
  getNftActionTicketProgramAddress,
  getUsedNftsForProposal,
} from 'NftVotePlugin/accounts'
import { PositionWithMeta } from 'HeliumVotePlugin/sdk/types'
import { HeliumVsrClient } from 'HeliumVotePlugin/sdk/client'
import {
  nftVoteRecordKey,
  registrarKey,
  voterWeightRecordKey,
  maxVoterWeightRecordKey,
} from '@helium/voter-stake-registry-sdk'
import { getUnusedPositionsForProposal } from 'HeliumVotePlugin/utils/getUnusedPositionsForProposal'
import { getUsedPositionsForProposal } from 'HeliumVotePlugin/utils/getUsedPositionsForProposal'
import { getAssociatedTokenAddress } from '@blockworks-foundation/mango-v4'
import { NftVoterClient } from './NftVoterClient'
import queryClient from '@hooks/queries/queryClient'
import asFindable from '@utils/queries/asFindable'
import { fetchNFTbyMint } from '@hooks/queries/nft'
import { getCompressedNftParamAndProof } from '@tools/compressedNftParam'

/***
 * @description: zip two arrays into one
 * @param {U} a
 * @param {T} b
 * @return {(U, T)[][]}
 */
export function zip<U, T>(a: U[], b: T[]): (U | T)[][] {
  const zipArray = a.map((k, i) => [k, b[i]])
  return zipArray
}

type UpdateVoterWeightRecordTypes =
  | 'castVote'
  | 'commentProposal'
  | 'createGovernance'
  | 'createProposal'
  | 'signOffProposal'

export interface VotingClientProps {
  client: Client | undefined
  realm: ProgramAccount<Realm> | undefined
  walletPk: PublicKey | null | undefined
}

export interface NFTWithMeta extends NFTWithMint {
  getAssociatedTokenAccount(): Promise<string>
}

export enum VotingClientType {
  NoClient,
  VsrClient,
  HeliumVsrClient,
  NftVoterClient,
  SwitchboardVoterClient,
  PythClient,
  GatewayClient,
}

class AccountData {
  pubkey: PublicKey
  isSigner: boolean
  isWritable: boolean
  constructor(
    pubkey: PublicKey | string,
    isSigner = false,
    isWritable = false
  ) {
    this.pubkey = typeof pubkey === 'string' ? new PublicKey(pubkey) : pubkey
    this.isSigner = isSigner
    this.isWritable = isWritable
  }
}

interface ProgramAddresses {
  voterWeightPk: PublicKey | undefined
  maxVoterWeightRecord: PublicKey | undefined
}

export type Client =
  | VsrClient
  | HeliumVsrClient
  | NftVoterClient
  | SwitchboardQueueVoterClient
  | PythClient
  | GatewayClient

//Abstract for common functions that plugins will implement
export class VotingClient {
  client: Client | undefined
  realm: ProgramAccount<Realm> | undefined
  walletPk: PublicKey | null | undefined
  votingNfts: any[]
  heliumVsrVotingPositions: PositionWithMeta[]
  gatewayToken: PublicKey
  oracles: PublicKey[]
  instructions: TransactionInstruction[]
  clientType: VotingClientType
  noClient: boolean
  constructor({ client, realm, walletPk }: VotingClientProps) {
    this.client = client
    this.realm = realm
    this.walletPk = walletPk
    this.votingNfts = []
    this.heliumVsrVotingPositions = []
    this.oracles = []
    this.instructions = []
    this.noClient = true
    this.clientType = VotingClientType.NoClient
    if (this.client instanceof VsrClient) {
      this.clientType = VotingClientType.VsrClient
      this.noClient = false
    }
    if (this.client instanceof HeliumVsrClient) {
      this.clientType = VotingClientType.HeliumVsrClient
      this.noClient = false
    }
    if (this.client instanceof NftVoterClient) {
      this.clientType = VotingClientType.NftVoterClient
      this.noClient = false
    }
    if (this.client instanceof SwitchboardQueueVoterClient) {
      this.clientType = VotingClientType.SwitchboardVoterClient
      this.noClient = false
    }
    if (this.client instanceof GatewayClient) {
      this.clientType = VotingClientType.GatewayClient
      this.noClient = false
    }
    if (this.client instanceof GatewayClient) {
      this.clientType = VotingClientType.GatewayClient
      this.noClient = false
    }
    if (this.client instanceof PythClient) {
      this.clientType = VotingClientType.PythClient
      this.noClient = false
    }
  }
  withUpdateVoterWeightRecord = async (
    instructions: TransactionInstruction[],
    tokenOwnerRecord: ProgramAccount<TokenOwnerRecord>,
    type: UpdateVoterWeightRecordTypes,
    voterWeightTarget?: PublicKey,
    createNftActionTicketIxs?: TransactionInstruction[]
  ): Promise<ProgramAddresses | undefined> => {
    const realm = this.realm!

    if (
      this.noClient ||
      !realm.account.communityMint.equals(
        tokenOwnerRecord.account.governingTokenMint
      )
    ) {
      return
    }
    const clientProgramId = this.client!.program.programId
    const walletPk = this.walletPk!

    if (this.client instanceof VsrClient) {
      const { registrar } = await getRegistrarPDA(
        realm.pubkey,
        realm.account.communityMint,
        clientProgramId
      )
      const { voter } = await getVoterPDA(registrar, walletPk, clientProgramId)
      const { voterWeightPk } = await getVoterWeightPDA(
        registrar,
        walletPk,
        clientProgramId
      )
      const updateVoterWeightRecordIx = await this.client!.program.methods.updateVoterWeightRecord()
        .accounts({
          registrar,
          voter,
          voterWeightRecord: voterWeightPk,
          systemProgram: SYSTEM_PROGRAM_ID,
        })
        .instruction()
      instructions.push(updateVoterWeightRecordIx)
      return { voterWeightPk, maxVoterWeightRecord: undefined }
    }

    if (this.client instanceof HeliumVsrClient) {
      const remainingAccounts: AccountData[] = []
      const [registrar] = registrarKey(
        realm.pubkey,
        realm.account.communityMint,
        clientProgramId
      )

      for (const pos of this.heliumVsrVotingPositions) {
        const tokenAccount = await getAssociatedTokenAddress(pos.mint, walletPk)

        remainingAccounts.push(
          new AccountData(tokenAccount),
          new AccountData(pos.pubkey)
        )
      }

      const [voterWeightPk] = voterWeightRecordKey(
        registrar,
        walletPk,
        clientProgramId
      )

      const [maxVoterWeightPk] = maxVoterWeightRecordKey(
        realm.pubkey,
        realm.account.communityMint,
        clientProgramId
      )

      instructions.push(
        await (this.client as HeliumVsrClient).program.methods
          .updateVoterWeightRecordV0({
            owner: walletPk,
            voterWeightAction: {
              [type]: {},
            },
          } as any)
          .accounts({
            registrar,
            voterWeightRecord: voterWeightPk,
            voterTokenOwnerRecord: tokenOwnerRecord.pubkey,
          })
          .remainingAccounts(remainingAccounts.slice(0, 10))
          .instruction()
      )

      return {
        voterWeightPk,
        maxVoterWeightRecord: maxVoterWeightPk,
      }
    }

    if (this.client instanceof NftVoterClient) {
      const { registrar } = await getPluginRegistrarPDA(
        realm.pubkey,
        realm.account.communityMint,
        clientProgramId
      )
      const {
        voterWeightPk,
        maxVoterWeightRecord,
      } = await this._withHandleNftVoterWeight(
        realm,
        walletPk,
        clientProgramId,
        instructions
      )

      const ticketType = `nft-${type}-ticket`

      // udpate voter weight record can upmost encapsulate 10 nfts
      const firstTenNfts = this.votingNfts.slice(0, 10)
      const nftActionTicketAccounts: AccountData[] = []

      const nfts = firstTenNfts.filter((x) => !x.compression.compressed)
      const nftRemainingAccounts: AccountData[] = []
      for (const nft of nfts) {
        const { nftActionTicket } = await getNftActionTicketProgramAddress(
          ticketType,
          registrar,
          walletPk,
          nft.id,
          clientProgramId
        )

        const tokenAccount = await getAssociatedTokenAddress(
          new PublicKey(nft.id),
          walletPk,
          true
        )
        const metadata = await fetchNFTbyMint(
          this.client.program.provider.connection,
          new PublicKey(nft.id)
        )
        nftRemainingAccounts.push(
          new AccountData(tokenAccount),
          new AccountData(metadata?.result?.metadataAddress || ''),
          new AccountData(nftActionTicket, false, true)
        )

        nftActionTicketAccounts.push(
          new AccountData(nftActionTicket, false, true)
        )
      }

      const nftChunks = chunks(nftRemainingAccounts, 15)
      for (const chunk of [...nftChunks]) {
        createNftActionTicketIxs?.push(
          await this.client.program.methods
            .createNftActionTicket({ [type]: {} })
            .accounts({
              registrar,
              voterWeightRecord: voterWeightPk,
              voterAuthority: walletPk,
              payer: walletPk,
              systemProgram: SYSTEM_PROGRAM_ID,
            })
            .remainingAccounts(chunk)
            .instruction()
        )
      }

      const compressedNfts = firstTenNfts.filter(
        (x) => x.compression.compressed
      )
      for (const cnft of compressedNfts) {
        const { nftActionTicket } = await getNftActionTicketProgramAddress(
          ticketType,
          registrar,
          walletPk,
          cnft.id,
          clientProgramId
        )

        const {
          param,
          additionalAccounts,
        } = await getCompressedNftParamAndProof(
          this.client.program.provider.connection,
          cnft
        )
        const instruction = await this.client.program.methods
          .createCnftActionTicket({ [type]: {} }, [param])
          .accounts({
            registrar,
            voterWeightRecord: voterWeightPk,
            payer: walletPk,
            compressionProgram: ACCOUNT_COMPACTION_PROGRAM_ID,
            systemProgram: SYSTEM_PROGRAM_ID,
          })
          .remainingAccounts([
            ...additionalAccounts,
            new AccountData(nftActionTicket, false, true),
          ])
          .instruction()
        createNftActionTicketIxs?.push(instruction)

        nftActionTicketAccounts.push(
          new AccountData(nftActionTicket, false, true)
        )
      }

      const updateVoterWeightRecordIx = await this.client.program.methods
        .updateVoterWeightRecord({ [type]: {} })
        .accounts({
          registrar: registrar,
          voterWeightRecord: voterWeightPk,
          payer: walletPk,
        })
        .remainingAccounts(nftActionTicketAccounts)
        .instruction()
      instructions.push(updateVoterWeightRecordIx)
      return { voterWeightPk, maxVoterWeightRecord }
    }
    if (this.client instanceof GatewayClient) {
      const { voterWeightPk } = await this._withHandleGatewayVoterWeight(
        realm,
        walletPk,
        clientProgramId,
        instructions
      )

      if (!this.gatewayToken)
        throw new Error(`Unable to execute transaction: No Civic Pass found`)

      const updateVoterWeightRecordIx = await getVoteInstruction(
        this.client,
        this.gatewayToken,
        realm,
        walletPk
      )
      instructions.push(updateVoterWeightRecordIx)
      return { voterWeightPk, maxVoterWeightRecord: undefined }
    }
    if (this.client instanceof PythClient) {
      const stakeAccount = await this.client!.stakeConnection.getMainAccount(
        walletPk
      )

      const {
        voterWeightAccount,
        maxVoterWeightRecord,
      } = await this.client.stakeConnection.withUpdateVoterWeight(
        instructions,
        stakeAccount!,
        { [type]: {} },
        voterWeightTarget
      )

      return {
        voterWeightPk: voterWeightAccount,
        maxVoterWeightRecord,
      }
    }
    if (this.client instanceof SwitchboardQueueVoterClient) {
      instructions.push(this.instructions[0])
      const [vwr] = await PublicKey.findProgramAddress(
        [Buffer.from('VoterWeightRecord'), this.oracles[0].toBytes()],
        SWITCHBOARD_ADDIN_ID
      )
      return { voterWeightPk: vwr, maxVoterWeightRecord: undefined }
    }
  }
  withCastPluginVote = async (
    instructions: TransactionInstruction[],
    proposal: ProgramAccount<Proposal>,
    tokenOwnerRecord: ProgramAccount<TokenOwnerRecord>,
    createNftActionTicketIxs?: TransactionInstruction[]
  ): Promise<ProgramAddresses | undefined> => {
    if (this.noClient) {
      return
    }
    const clientProgramId = this.client!.program.programId
    const realm = this.realm!
    const walletPk = this.walletPk!
    if (
      realm.account.communityMint.toBase58() !==
      proposal.account.governingTokenMint.toBase58()
    ) {
      return
    }

    if (this.client instanceof VsrClient) {
      const props = await this.withUpdateVoterWeightRecord(
        instructions,
        tokenOwnerRecord,
        'castVote'
      )
      return props
    }

    if (this.client instanceof SwitchboardQueueVoterClient) {
      const props = await this.withUpdateVoterWeightRecord(
        instructions,
        tokenOwnerRecord,
        'castVote'
      )
      return props
    }

    if (this.client instanceof PythClient) {
      const props = await this.withUpdateVoterWeightRecord(
        instructions,
        tokenOwnerRecord,
        'castVote',
        proposal.pubkey
      )
      return props
    }

    if (this.client instanceof GatewayClient) {
      // get the gateway plugin vote instruction
      const instruction = await getVoteInstruction(
        this.client,
        this.gatewayToken,
        realm,
        walletPk
      )

      instructions.push(instruction)

      const { voterWeightPk } = await this._withHandleGatewayVoterWeight(
        realm,
        walletPk,
        clientProgramId,
        instructions
      )

      return { voterWeightPk, maxVoterWeightRecord: undefined }
    }

    if (this.client instanceof HeliumVsrClient) {
      const remainingAccounts: AccountData[] = []

      const [registrar] = registrarKey(
        realm.pubkey,
        realm.account.communityMint,
        clientProgramId
      )

      const unusedPositions = await getUnusedPositionsForProposal({
        connection: this.client.program.provider.connection,
        client: this.client,
        positions: this.heliumVsrVotingPositions,
        proposalPk: proposal.pubkey,
      })

      const [voterWeightPk] = voterWeightRecordKey(
        registrar,
        walletPk,
        clientProgramId
      )

      const [maxVoterWeightPk] = maxVoterWeightRecordKey(
        realm.pubkey,
        realm.account.communityMint,
        clientProgramId
      )

      for (let i = 0; i < unusedPositions.length; i++) {
        const pos = unusedPositions[i]
        const tokenAccount = await getAssociatedTokenAddress(pos.mint, walletPk)
        const [nftVoteRecord] = nftVoteRecordKey(
          proposal.pubkey,
          pos.mint,
          clientProgramId
        )

        remainingAccounts.push(
          new AccountData(tokenAccount),
          new AccountData(pos.pubkey, false, true),
          new AccountData(nftVoteRecord, false, true)
        )
      }

      //1 nft is 3 accounts
      const positionChunks = chunks(remainingAccounts, 9)
      for (const chunk of positionChunks) {
        instructions.push(
          await this.client.program.methods
            .castVoteV0({
              proposal: proposal.pubkey,
              owner: walletPk,
            })
            .accounts({
              registrar,
              voterTokenOwnerRecord: tokenOwnerRecord.pubkey,
            })
            .remainingAccounts(chunk)
            .instruction()
        )
      }

      return {
        voterWeightPk,
        maxVoterWeightRecord: maxVoterWeightPk,
      }
    }

    if (this.client instanceof NftVoterClient) {
      const { registrar } = await getPluginRegistrarPDA(
        realm.pubkey,
        realm.account.communityMint,
        this.client.program.programId
      )

      const {
        voterWeightPk,
        maxVoterWeightRecord,
      } = await this._withHandleNftVoterWeight(
        realm,
        walletPk,
        clientProgramId,
        instructions
      )

      const nftVoteRecordsFiltered = await getUsedNftsForProposal(
        this.client,
        proposal.pubkey
      )
      const castVoteRemainingAccounts: AccountData[] = []

      const type: UpdateVoterWeightRecordTypes = 'castVote'
      const ticketType = `nft-${type}-ticket`
      // create nft weight records for all nfts
      const nfts = this.votingNfts.filter((x) => !x.compression.compressed)
      const nftRemainingAccounts: AccountData[] = []
      for (const nft of nfts) {
        const { nftVoteRecord } = await getNftVoteRecordProgramAddress(
          proposal.pubkey,
          nft.id,
          clientProgramId
        )
        if (
          !nftVoteRecordsFiltered.find(
            (x) => x.publicKey.toBase58() === nftVoteRecord.toBase58()
          )
        ) {
          const { nftActionTicket } = await getNftActionTicketProgramAddress(
            ticketType,
            registrar,
            walletPk,
            nft.id,
            clientProgramId
          )

          const tokenAccount = await getAssociatedTokenAddress(
            new PublicKey(nft.id),
            walletPk,
            true
          )
          const metadata = await fetchNFTbyMint(
            this.client.program.provider.connection,
            new PublicKey(nft.id)
          )

          nftRemainingAccounts.push(
            new AccountData(tokenAccount),
            new AccountData(metadata?.result?.metadataAddress || ''),
            new AccountData(nftActionTicket, false, true)
          )

          castVoteRemainingAccounts.push(
            new AccountData(nftActionTicket, false, true),
            new AccountData(nftVoteRecord, false, true)
          )
        }
      }

      const createNftVoteTicketChunks = chunks(nftRemainingAccounts, 15)
      for (const chunk of [...createNftVoteTicketChunks]) {
        createNftActionTicketIxs?.push(
          await this.client.program.methods
            .createNftActionTicket({ [type]: {} })
            .accounts({
              registrar,
              voterWeightRecord: voterWeightPk,
              voterAuthority: walletPk,
              payer: walletPk,
              systemProgram: SYSTEM_PROGRAM_ID,
            })
            .remainingAccounts(chunk)
            .instruction()
        )
      }

      // create nft weight record for all compressed nfts
      const cnfts = this.votingNfts.filter((x) => x.compression.compressed)
      for (const cnft of cnfts) {
        const { nftVoteRecord } = await getNftVoteRecordProgramAddress(
          proposal.pubkey,
          cnft.id,
          clientProgramId
        )
        if (
          !nftVoteRecordsFiltered.find(
            (x) => x.publicKey.toBase58() === nftVoteRecord.toBase58()
          )
        ) {
          const { nftActionTicket } = await getNftActionTicketProgramAddress(
            ticketType,
            registrar,
            walletPk,
            cnft.id,
            clientProgramId
          )

          const {
            param,
            additionalAccounts,
          } = await getCompressedNftParamAndProof(
            this.client.program.provider.connection,
            cnft
          )

          const instruction = await this.client.program.methods
            .createCnftActionTicket({ [type]: {} }, [param])
            .accounts({
              registrar,
              voterWeightRecord: voterWeightPk,
              payer: walletPk,
              compressionProgram: ACCOUNT_COMPACTION_PROGRAM_ID,
              systemProgram: SYSTEM_PROGRAM_ID,
            })
            .remainingAccounts([
              ...additionalAccounts,
              new AccountData(nftActionTicket, false, true),
            ])
            .instruction()
          createNftActionTicketIxs?.push(instruction)

          castVoteRemainingAccounts.push(
            new AccountData(nftActionTicket, false, true),
            new AccountData(nftVoteRecord, false, true)
          )
        }
      }
      const castVoteRemainingAccountsChunks = chunks(
        castVoteRemainingAccounts,
        12
      )
      for (const chunk of [...castVoteRemainingAccountsChunks]) {
        instructions.push(
          await this.client.program.methods
            .castNftVote(proposal.pubkey)
            .accounts({
              registrar,
              voterWeightRecord: voterWeightPk,
              voterTokenOwnerRecord: tokenOwnerRecord.pubkey,
              voterAuthority: walletPk,
              payer: walletPk,
              systemProgram: SYSTEM_PROGRAM_ID,
            })
            .remainingAccounts(chunk)
            .instruction()
        )
      }
      console.log(instructions.length)
      return { voterWeightPk, maxVoterWeightRecord }
    }
  }
  withRelinquishVote = async (
    instructions,
    proposal: ProgramAccount<Proposal>,
    voteRecordPk: PublicKey,
    tokenOwnerRecord: PublicKey
  ): Promise<ProgramAddresses | undefined> => {
    if (this.noClient) {
      return
    }
    const clientProgramId = this.client!.program.programId
    const realm = this.realm!
    const walletPk = this.walletPk!
    if (
      realm.account.communityMint.toBase58() !==
      proposal.account.governingTokenMint.toBase58()
    ) {
      return
    }

    if (this.client instanceof HeliumVsrClient) {
      const remainingAccounts: AccountData[] = []
      const [registrar] = registrarKey(
        realm.pubkey,
        realm.account.communityMint,
        clientProgramId
      )

      const [voterWeightPk] = voterWeightRecordKey(
        registrar,
        walletPk,
        clientProgramId
      )

      const usedPositions = await getUsedPositionsForProposal({
        connection: this.client.program.provider.connection,
        client: this.client,
        positions: this.heliumVsrVotingPositions,
        proposalPk: proposal.pubkey,
      })

      for (let i = 0; i < usedPositions.length; i++) {
        const pos = usedPositions[i]
        const [nftVoteRecord] = nftVoteRecordKey(
          proposal.pubkey,
          pos.mint,
          clientProgramId
        )

        remainingAccounts.push(
          new AccountData(nftVoteRecord, false, true),
          new AccountData(pos.pubkey, false, true)
        )
      }

      const firstFivePositions = remainingAccounts.slice(0, 10)
      const remainingPositionsChunk = chunks(
        remainingAccounts.slice(10, remainingAccounts.length),
        12
      )

      for (const chunk of [firstFivePositions, ...remainingPositionsChunk]) {
        instructions.push(
          await this.client.program.methods
            .relinquishVoteV0()
            .accounts({
              registrar,
              voterTokenOwnerRecord: tokenOwnerRecord,
              proposal: proposal.pubkey,
              governance: proposal.account.governance,
              voterWeightRecord: voterWeightPk,
              voteRecord: voteRecordPk,
              beneficiary: walletPk,
            })
            .remainingAccounts(chunk)
            .instruction()
        )
      }

      return {
        voterWeightPk,
        maxVoterWeightRecord: undefined,
      }
    }

    if (this.client instanceof NftVoterClient) {
      const remainingAccounts: AccountData[] = []
      const { registrar } = await getPluginRegistrarPDA(
        realm.pubkey,
        realm.account.communityMint,
        this.client!.program.programId
      )
      const {
        voterWeightPk,
        maxVoterWeightRecord,
      } = await this._withHandleNftVoterWeight(
        realm!,
        walletPk,
        clientProgramId,
        instructions
      )
      const nftVoteRecordsFiltered = (
        await getUsedNftsForProposal(this.client, proposal.pubkey)
      ).filter(
        (x) => x.account.governingTokenOwner.toBase58() === walletPk.toBase58()
      )
      for (const voteRecord of nftVoteRecordsFiltered) {
        remainingAccounts.push(
          new AccountData(voteRecord.publicKey, false, true)
        )
      }
      const connection = this.client.program.provider.connection

      // if this was good code, this would appear outside of this fn.
      // But we're not writing good code, there's no good place for it, I'm not bothering.
      const voterWeightRecord = await queryClient.fetchQuery({
        queryKey: [voterWeightPk],
        queryFn: () =>
          asFindable(connection.getAccountInfo, connection)(voterWeightPk),
      })

      if (voterWeightRecord.result) {
        const firstFiveNfts = remainingAccounts.slice(0, 5)
        const remainingNftsChunk = chunks(
          remainingAccounts.slice(5, remainingAccounts.length),
          12
        )

        for (const chunk of [firstFiveNfts, ...remainingNftsChunk]) {
          instructions.push(
            await this.client.program.methods
              .relinquishNftVote()
              .accounts({
                registrar,
                voterWeightRecord: voterWeightPk,
                governance: proposal.account.governance,
                proposal: proposal.pubkey,
                voterTokenOwnerRecord: tokenOwnerRecord,
                voterAuthority: walletPk,
                voteRecord: voteRecordPk,
                beneficiary: walletPk,
              })
              .remainingAccounts(chunk)
              .instruction()
          )
        }
      }

      return { voterWeightPk, maxVoterWeightRecord }
    }
  }

  _withHandleNftVoterWeight = async (
    realm: ProgramAccount<Realm>,
    walletPk: PublicKey,
    clientProgramId: PublicKey,
    _instructions
  ) => {
    if (this.client instanceof NftVoterClient === false) {
      throw 'Method only allowed for nft voter client'
    }
    const {
      voterWeightPk,
      voterWeightRecordBump,
    } = await getPluginVoterWeightRecord(
      realm!.pubkey,
      realm!.account.communityMint,
      walletPk!,
      clientProgramId
    )

    const {
      maxVoterWeightRecord,
      maxVoterWeightRecordBump,
    } = await getPluginMaxVoterWeightRecord(
      realm!.pubkey,
      realm!.account.communityMint,
      clientProgramId
    )

    return {
      voterWeightPk,
      voterWeightRecordBump,
      maxVoterWeightRecord,
      maxVoterWeightRecordBump,
    }
  }

  // TODO: this can probably be merged with the nft voter plugin implementation
  _withHandleGatewayVoterWeight = async (
    realm: ProgramAccount<Realm>,
    walletPk: PublicKey,
    clientProgramId: PublicKey,
    _instructions
  ) => {
    if (!(this.client instanceof GatewayClient)) {
      throw 'Method only allowed for gateway client'
    }
    const {
      voterWeightPk,
      voterWeightRecordBump,
    } = await getPluginVoterWeightRecord(
      realm.pubkey,
      realm.account.communityMint,
      walletPk,
      clientProgramId
    )

    const previousVoterWeightPk = await getPreviousVotingWeightRecord(
      this.client,
      realm,
      walletPk
    )

    return {
      previousVoterWeightPk,
      voterWeightPk,
      voterWeightRecordBump,
    }
  }
  _setCurrentVoterNfts = (nfts: any[]) => {
    this.votingNfts = nfts
  }
  _setCurrentHeliumVsrPositions = (positions: PositionWithMeta[]) => {
    this.heliumVsrVotingPositions = positions
  }
  _setCurrentVoterGatewayToken = (gatewayToken: PublicKey) => {
    this.gatewayToken = gatewayToken
  }
  _setOracles = (oracles: PublicKey[]) => {
    this.oracles = oracles
  }
  _setInstructions = (instructions: TransactionInstruction[]) => {
    this.instructions = instructions
  }
}
