import { NFT_PLUGINS_PKS } from '@constants/plugins'
import Members from './Members'
import NftPluginMembers from './NftPluginMembers'
import { useRealmConfigQuery } from '@hooks/queries/realmConfig'

const MembersPage = () => {
  const config = useRealmConfigQuery().data?.result
  return (
    <div>
      {!config?.account.communityTokenConfig.voterWeightAddin ? (
        <Members />
      ) : NFT_PLUGINS_PKS.includes(
          config?.account.communityTokenConfig.voterWeightAddin.toBase58()
        ) ? (
        <NftPluginMembers />
      ) : null}
    </div>
  )
}

export default MembersPage
