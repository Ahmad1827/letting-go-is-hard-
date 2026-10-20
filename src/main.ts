import Phaser from 'phaser';
import './style.css';
import { OfficeScene } from './scenes/OfficeScene';
import { initHud } from './ui/hud';
import { HEIGHT, WIDTH } from './world/map';

initHud();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WIDTH,
  height: HEIGHT,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#1b1b1b',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [OfficeScene],
});
