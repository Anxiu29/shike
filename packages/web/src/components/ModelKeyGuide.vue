<script setup lang="ts">
import { computed } from 'vue'
import { personalProviders, personalModelInfo, type PersonalProvider } from '@shike/shared'
import { modelKeyGuides, modelKeyGuideCheckedOn } from '../lib/model-key-guides'
const props = withDefaults(defineProps<{ provider: PersonalProvider; audience?: 'android' | 'web' }>(), { audience: 'android' })
const platform = computed(() => personalProviders.find(item => item.id === props.provider)!)
const guide = computed(() => modelKeyGuides[props.provider])
const keyUrl = computed(() => personalModelInfo(props.provider, platform.value.models[0]).keyUrl)
const webConfig = computed(() => `AI_PROVIDER=${props.provider}\nAI_MODE=auto\n${guide.value.envKey}=替换为你申请的Key${props.provider === 'glm' ? '\nGLM_MODEL=glm-5.3-flash' : ''}`)
</script>

<template>
  <section class="model-key-guide" data-testid="model-key-guide">
    <h3 data-testid="key-guide-title">{{ platform.name }} · 申请步骤</h3>
    <p class="key-guide-models" data-testid="key-guide-models">食刻当前支持：{{ platform.models.join('、') }}</p>
    <div class="key-guide-links"><a :href="keyUrl" target="_blank" rel="noopener noreferrer" data-testid="key-guide-console">打开官方 Key 页面 ↗</a><a :href="guide.docsUrl" target="_blank" rel="noopener noreferrer" data-testid="key-guide-docs">官方申请说明 ↗</a><a v-if="guide.modelUrl" :href="guide.modelUrl" target="_blank" rel="noopener noreferrer" data-testid="key-guide-model-docs">模型说明与调用示例 ↗</a><a v-for="link in guide.modelLinks" :key="link.url" :href="link.url" target="_blank" rel="noopener noreferrer" data-testid="key-guide-model-link">{{ link.name }} 说明 ↗</a></div>
    <ol class="key-guide-steps"><li v-for="step in guide.steps" :key="step">{{ step }}</li><li v-if="audience === 'web'">在运行食刻服务的电脑上，将 Key 填入项目根目录 .env 的 {{ guide.envKey }}，保存后重启食刻的 Node 服务，再刷新网页。</li><li v-else>回到食刻，选择平台并勾选模型，Key 只粘贴一次，再点“测试并保存”。测试默认／当前模型会发送一张内置测试图，可能消耗少量额度；新增另一把 Key 后需点“选用”。</li></ol>
    <section v-if="guide.payment" class="key-guide-payment" data-testid="key-guide-payment"><h4>{{ guide.payment.title }}</h4><p>{{ guide.payment.note }}</p><div class="key-guide-links"><a :href="guide.payment.consoleUrl" target="_blank" rel="noopener noreferrer" data-testid="key-guide-payment-console">打开官方控制台／我的资源包 ↗</a><a :href="guide.payment.pricingUrl" target="_blank" rel="noopener noreferrer" data-testid="key-guide-payment-pricing">查看官方按量价格 ↗</a></div><ol><li v-for="step in guide.payment.steps" :key="step">{{ step }}</li><li v-if="audience === 'web'">下方示例使用glm-5.3-flash。按自己的资源包将GLM_MODEL改为匹配型号后重启服务，或在网页列表手动选择。已有Key只需保留同一个ZHIPU_API_KEY变量。</li><li v-else>回食刻打开“我的AI模型”，编辑原智谱Key组，勾选与资源包匹配的glm-5.3-flash或glm-5.3-flashx并设为默认／当前模型；Key留空保留原Key，再点“测试并保存”。新建组需粘贴Key；之后点“选用”。测试也消耗额度。</li></ol></section>
    <div v-if="audience === 'web'" class="key-guide-web-config" data-testid="key-guide-web-config"><strong>网页版配置示例</strong><p>首次配置可把根目录的 .env.example 复制为 .env，再填写下面几项。已有同名项请直接修改；示例中的 Key 占位文字需要替换。</p><pre data-testid="key-guide-env"><code>{{ webConfig }}</code></pre><p>AI_PROVIDER 设置默认平台；多个平台的 Key 变量可以同时保留。密钥只放在服务所在电脑的 .env，不要写入 VITE_ 变量。若使用别人部署的网页，请让部署者配置。</p></div>
    <p class="notice subtle">{{ guide.note }}</p>
    <div class="key-guide-sharing"><strong>一把 Key 可以配多个模型</strong><template v-if="audience === 'web'"><p>同平台的 Key 变量只需填一次，服务会列出食刻已适配的型号。重启服务并刷新网页后，在拍照或文字记餐的模型列表中切换；更换 Key 只需修改这个变量。</p><p>模型仍受权限、地域、项目和额度限制。配置不会自动测试模型，实际识别可能消耗额度；切换型号不会增加平台额度。</p></template><template v-else><p>在一组配置里勾选同平台多个模型，Key 只填一次；已有配置可点“管理可用模型”继续勾选。拍照时选择这组下的任一模型，更换 Key 只需编辑这一组。</p><p>模型权限、地域、项目和额度仍需满足平台要求，勾选多个模型不会增加额度。保存只测试默认／当前模型；删除整组会移除这把 Key 和其模型选项。</p></template></div>
    <details class="key-guide-errors"><summary>{{ audience === 'web' ? '配置后无法识别怎么排查' : '测试失败怎么排查' }}</summary><p v-if="audience === 'web'">仍显示模拟模式：检查 AI_MODE 是否被设为 mock、所选平台的 Key 是否填写，以及修改后是否重启服务并刷新页面。</p><p>401：检查 Key 是否完整、已撤销或选错平台。402：检查余额。403：检查项目、地域和模型权限。429：检查限流或额度，稍后重试；无需反复申请新 Key。网络超时：检查{{ audience === 'web' ? '服务所在电脑' : '手机' }}能否访问对应平台。</p></details>
    <p class="tiny muted">教程核实：{{ modelKeyGuideCheckedOn }}。平台页面与政策可能变化，按官方当前页面操作。{{ audience === 'web' ? 'Key 只写入服务端 .env' : 'Key 只粘贴到食刻输入框' }}，不要发到聊天或截图。</p>
  </section>
</template>
