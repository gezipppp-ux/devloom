<script>
import { defineComponent, watch } from "vue";
import { showMessage } from "./operation-messages.js";

export default defineComponent({
  props: {
    message: { type: String, default: "" },
    type: { type: String, default: "info" },
  },
  setup(props) {
    watch(() => [props.message, props.type], ([message, type]) => showMessage(message, type), { immediate: true });
    return () => null;
  },
});
</script>
