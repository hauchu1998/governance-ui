import { BN } from '@coral-xyz/anchor'
import { MaxVoterWeightRecord, ProgramAccount } from '@solana/spl-governance'
import { VotingClient } from '@utils/uiTypes/VotePlugin'
import create, { State } from 'zustand'

interface nftPluginStore extends State {
  state: {
    votingNfts: any[]
    votingPower: BN
    maxVoteRecord: ProgramAccount<MaxVoterWeightRecord> | null
    isLoadingNfts: boolean
  }
  setVotingNfts: (
    nfts: any[],
    votingClient: VotingClient,
    nftMintRegistrar: any
  ) => void
  setVotingPower: (nfts: any[], nftMintRegistrar: any) => void
  setMaxVoterWeight: (
    maxVoterRecord: ProgramAccount<MaxVoterWeightRecord> | null
  ) => void
  setIsLoadingNfts: (val: boolean) => void
}

const defaultState = {
  votingNfts: [],
  votingPower: new BN(0),
  maxVoteRecord: null,
  isLoadingNfts: false,
}

const useNftPluginStore = create<nftPluginStore>((set, _get) => ({
  state: {
    ...defaultState,
  },
  setIsLoadingNfts: (val) => {
    set((s) => {
      s.state.isLoadingNfts = val
    })
  },
  setVotingNfts: (nfts, votingClient, nftMintRegistrar) => {
    votingClient._setCurrentVoterNfts(nfts)
    set((s) => {
      s.state.votingNfts = nfts
    })
    _get().setVotingPower(nfts, nftMintRegistrar)
  },
  setVotingPower: (nfts, nftMintRegistrar) => {
    const votingPower = nfts
      .map(
        (x) =>
          nftMintRegistrar?.collectionConfigs?.find((j) =>
            x.grouping.find(
              (k) =>
                k.group_key === 'collection' &&
                k.group_value === j.collection?.toBase58()
            )
          )?.weight || new BN(0)
      )
      .reduce((prev, next) => prev.add(next), new BN(0))
    set((s) => {
      s.state.votingPower = votingPower
    })
  },
  setMaxVoterWeight: (maxVoterRecord) => {
    set((s) => {
      s.state.maxVoteRecord = maxVoterRecord
    })
  },
}))

export default useNftPluginStore
