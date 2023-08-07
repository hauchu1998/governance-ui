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

export interface NftVoteTicket {
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

export const getNftVoteTicketsForRegistrar = async (
  client: NftVoterClient,
  registrar: PublicKey
) => {
  const nftVoteTicketsFiltered = ((await client.program.account.nftVoteTicket.all(
    [
      {
        memcmp: {
          offset: 8,
          bytes: registrar.toBase58(),
        },
      },
    ]
  )) as unknown) as NftVoteTicket[]
  return nftVoteTicketsFiltered
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

export const getNftVoteTicketProgramAddress = async (
  ticketType: string,
  registrar: PublicKey,
  nftMintAddress: string,
  clientProgramId: PublicKey
) => {
  const [nftVoteTicket, nftVoteTicketBump] = await PublicKey.findProgramAddress(
    [
      Buffer.from(ticketType),
      registrar.toBuffer(),
      new PublicKey(nftMintAddress).toBuffer(),
    ],
    clientProgramId
  )

  return {
    nftVoteTicket,
    nftVoteTicketBump,
  }
}
