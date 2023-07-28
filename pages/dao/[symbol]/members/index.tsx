import { NFT_PLUGINS_PKS } from '@constants/plugins'
import Members from './Members'
import { useRealmConfigQuery } from '@hooks/queries/realmConfig'
import NftPluginMembers from './NftPluginMembers'
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
