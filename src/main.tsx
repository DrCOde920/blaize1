import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initClientApiInterceptor } from './utils/api_client';

initClientApiInterceptor();

createRoot(document.getElementById('root')!).render(<App />);
