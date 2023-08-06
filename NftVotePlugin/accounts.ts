import { NftVoterClient } from '@utils/uiTypes/NftVoterClient'
import { PublicKey } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
export interface NftVoteRecord {
  account: {
    governingTokenOwner: PublicKey
    nftMint: PublicKey
    proposal: PublicKey
  }
  publicKey: PublicKey
}

export interface NftWeightRecord {
  account: {
    nft_owner: PublicKey
    weight: BN
  }
  publicKey: PublicKey
}

export const getUsedNftsForProposal = async (
  client: NftVoterClient,
  proposalPk: PublicKey
) => {
  const nftVoteRecordsFiltered = (await client.program.account.nftVoteRecord.all(
    [
      {
        memcmp: {
          offset: 8,
          bytes: proposalPk.toBase58(),
        },
      },
    ]
  )) as NftVoteRecord[]
  return nftVoteRecordsFiltered
}

export const getUsedNftWeightRecordsForOwner = async (
  client: NftVoterClient,
  owner: PublicKey
) => {
  const nftWeightRecordsFiltered = ((await client.program.account.nftWeightRecord.all(
    [
      {
        memcmp: {
          offset: 8,
          bytes: owner.toBase58(),
        },
      },
    ]
  )) as unknown) as NftWeightRecord[]
  return nftWeightRecordsFiltered
}

export const getNftVoteRecordProgramAddress = async (
  proposalPk: PublicKey,
  nftMintAddress: string,
  clientProgramId: PublicKey
) => {
  const [nftVoteRecord, nftVoteRecordBump] = await PublicKey.findProgramAddress(
    [
      Buffer.from('nft-vote-record'),
      proposalPk.toBuffer(),
      new PublicKey(nftMintAddress).toBuffer(),
    ],
    clientProgramId
  )

  return {
    nftVoteRecord,
    nftVoteRecordBump,
  }
}

export const getNftWeightRecordProgramAddress = async (
  nftMintAddress: string,
  owner: PublicKey,
  clientProgramId: PublicKey
) => {
  const [
    nftWeightRecord,
    nftWeightRecordBump,
  ] = await PublicKey.findProgramAddress(
    [
      Buffer.from('nft-weight-record'),
      owner.toBuffer(),
      new PublicKey(nftMintAddress).toBuffer(),
    ],
    clientProgramId
  )

  return {
    nftWeightRecord,
    nftWeightRecordBump,
  }
}
