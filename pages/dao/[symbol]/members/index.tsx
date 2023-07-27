import { NFT_PLUGINS_PKS } from '@constants/plugins'
import Members from './Members'
import { useRealmConfigQuery } from '@hooks/queries/realmConfig'
const MembersPage = () => {
  const config = useRealmConfigQuery().data?.result
  return (
    <div>
      {!config?.account.communityTokenConfig.voterWeightAddin ||
      NFT_PLUGINS_PKS.includes(
        config?.account.communityTokenConfig.voterWeightAddin.toBase58()
      ) ? (
        <Members />
      ) : null}
    </div>
  )
}

export default MembersPage
