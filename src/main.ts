import Phaser from 'phaser';
import './style.css';
import { OfficeScene } from './scenes/OfficeScene';
import { initHud } from './ui/hud';

initHud();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#05081a',
  scale: { mode: Phaser.Scale.RESIZE },
  scene: [OfficeScene],
});
