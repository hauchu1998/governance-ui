import { AccountInfo } from '@solana/spl-token'
import { BN_ZERO } from '@solana/spl-governance'
import { getTokenAccountsByMint, TokenProgramAccount } from '@utils/tokens'
import { capitalize } from '@utils/helpers'
import { NftPluginMember } from 'utils/uiTypes/members'
import { useRealmQuery } from '@hooks/queries/realm'
import { useTokenOwnerRecordsForRealmQuery } from '@hooks/queries/tokenOwnerRecord'
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '@solana/wallet-adapter-react'
import { BN } from '@coral-xyz/anchor'
import { useRealmConfigQuery } from '@hooks/queries/realmConfig'
import useVotePluginsClientStore from 'stores/useVotePluginsClientStore'
import { useMemo } from 'react'
import { NFT_PLUGINS_PKS } from '@constants/plugins'
import { fetchDigitalAssetsByOwner } from '@hooks/queries/digitalAssets'
import { getNetworkFromEndpoint } from '@utils/connection'

export const useNftPluginMembersQuery = () => {
  const realm = useRealmQuery().data?.result
  const { data: tors } = useTokenOwnerRecordsForRealmQuery()
  const connection = useConnection()

  const config = useRealmConfigQuery().data?.result
  const currentPluginPk = config?.account.communityTokenConfig.voterWeightAddin
  const [nftMintRegistrar] = useVotePluginsClientStore((s) => [
    s.state.nftMintRegistrar,
  ])

  const usedCollectionsPks: string[] = useMemo(
    () =>
      (currentPluginPk &&
        NFT_PLUGINS_PKS.includes(currentPluginPk?.toBase58()) &&
        nftMintRegistrar?.collectionConfigs.map((x) =>
          x.collection.toBase58()
        )) ||
      undefined,
    [currentPluginPk, nftMintRegistrar?.collectionConfigs]
  )

  const network = getNetworkFromEndpoint(connection.connection.rpcEndpoint)
  if (network === 'localnet') throw new Error()

  const enabled =
    tors !== undefined &&
    realm !== undefined &&
    usedCollectionsPks !== undefined
  const querykies =
    tors?.map((x) => x.account.governingTokenOwner.toString()) ?? []

  const query = useQuery({
    enabled,
    queryKey: [...querykies, 'nft plugin members'],
    queryFn: async () => {
      if (!enabled) throw new Error()

      const councilMint = realm.account.config.councilMint
      const councilRecordArray =
        councilMint !== undefined
          ? tors
              .filter((x) => x.account.governingTokenMint.equals(councilMint))
              .map((x) => ({
                walletAddress: x.account.governingTokenOwner.toString(),
                council: x,
                _kind: 'council' as const,
                nfts: [],
              }))
          : []

      const tokenRecordArray = await Promise.all(
        tors.map(async (x) => {
          const ownedNfts = await fetchDigitalAssetsByOwner(
            network,
            x.account.governingTokenOwner
          )
          const verifiedNfts = ownedNfts.filter((nft) => {
            const collection = nft.grouping.find(
              (x) => x.group_key === 'collection'
            )
            return (
              collection &&
              usedCollectionsPks.includes(collection.group_value) &&
              (collection.verified ||
                typeof collection.verified === 'undefined')
            )
          })
          x.account.governingTokenDepositAmount = new BN(
            verifiedNfts.length * 10 ** 6
          )
          return {
            walletAddress: x.account.governingTokenOwner.toString(),
            community: x,
            _kind: 'community' as const,
            nfts: verifiedNfts,
          }
        })
      )

      const fetchCouncilMembersWithTokensOutsideRealm = async () => {
        if (realm?.account.config.councilMint) {
          const tokenAccounts = await getTokenAccountsByMint(
            connection.connection,
            realm.account.config.councilMint.toBase58()
          )
          const tokenAccountsInfo: TokenProgramAccount<AccountInfo>[] = []
          for (const acc of tokenAccounts) {
            tokenAccountsInfo.push(acc)
          }
          // we filter out people who dont have any tokens and we filter out accounts owned by realm e.g.
          // accounts that holds deposited tokens inside realm.
          return tokenAccountsInfo.filter(
            (x) =>
              !x.account.amount.isZero() &&
              x.account.owner.toBase58() !== realm?.pubkey.toBase58()
          )
        }
        return []
      }

      const matchMembers = (
        membersArray,
        membersToMatch,
        type,
        pushNonExisting = false
      ) => {
        const votesPropoName = `${type.toLowerCase()}Votes`
        const hasVotesOutsidePropName = `has${capitalize(
          type
        )}TokenOutsideRealm`
        const members = [...membersArray]
        for (const memberToMatch of membersToMatch) {
          // We match members that had deposited tokens at least once
          const member = members.find(
            (x) => x.walletAddress === memberToMatch.account.owner.toBase58()
          )
          if (member) {
            member[votesPropoName] = member[votesPropoName].add(
              memberToMatch.account.amount
            )
            if (!memberToMatch.account.amount.isZero()) {
              member[hasVotesOutsidePropName] = true
            }
          } else if (pushNonExisting) {
            // we add members who never deposited tokens inside realm
            members.push({
              walletAddress: memberToMatch.account.owner.toBase58(),
              votesCasted: 0,
              [votesPropoName]: memberToMatch.account.amount,
              communityVotes: BN_ZERO,
              [hasVotesOutsidePropName]: true,
              nft: [],
            })
          }
        }
        return members
      }

      // for community we exclude people who never vote
      const communityAndCouncilTokenRecords = [
        ...tokenRecordArray,
        ...councilRecordArray,
      ]
      // merge community and council vote records to one big array of members
      // sort them by totalVotes sum of community and council votes
      const membersWithTokensDeposited =
        // remove duplicated walletAddresses
        Array.from(
          new Set(communityAndCouncilTokenRecords.map((s) => s.walletAddress))
        )
          // deduplication
          .map((walletAddress) => {
            return {
              ...communityAndCouncilTokenRecords
                .filter((x) => x.walletAddress === walletAddress)
                .reduce<NftPluginMember>(
                  (acc, curr) => {
                    const obj = {
                      ...acc,
                      walletAddress: curr.walletAddress,
                      communityVotes:
                        curr._kind === 'community'
                          ? curr.community.account.governingTokenDepositAmount
                          : acc.communityVotes,
                      councilVotes:
                        curr._kind === 'council'
                          ? curr.council.account.governingTokenDepositAmount
                          : acc.councilVotes,
                    }
                    if (curr._kind === 'community') {
                      obj.delegateWalletCommunity =
                        curr.community.account.governanceDelegate
                    }
                    if (curr._kind === 'council') {
                      obj.delegateWalletCouncil =
                        curr.council.account.governanceDelegate
                    }
                    if (curr.nfts) {
                      obj.nfts = curr.nfts
                    }
                    return obj
                  },
                  {
                    walletAddress: '',
                    councilVotes: BN_ZERO,
                    communityVotes: BN_ZERO,
                    nfts: [],
                  }
                ),
            }
          })
          .reverse()

      let members = [...membersWithTokensDeposited]

      const [councilMembers] = await Promise.all([
        fetchCouncilMembersWithTokensOutsideRealm(),
      ])
      members = matchMembers(members, councilMembers, 'council', true)
      console.log(members)
      const activeMembers = members.filter(
        (x) => !x.councilVotes.isZero() || !x.communityVotes.isZero()
      )

      return activeMembers
    },
  })
  return query
}
