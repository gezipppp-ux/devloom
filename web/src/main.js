import { createApp } from 'vue';
import { Form, FormItem } from 'antdv-next';
import App from './App.vue';
import './style.css';

createApp(App)
  .component('AForm', Form)
  .component('AFormItem', FormItem)
  .mount('#app');
