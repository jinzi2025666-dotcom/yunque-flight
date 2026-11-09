import './style.css';
import { Game } from './game.ts';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('找不到画面容器');

const game = new Game(root);
game.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.destroy());
}
