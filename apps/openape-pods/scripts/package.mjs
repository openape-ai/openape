import { build, Platform, Arch } from 'electron-builder'

if (process.platform !== 'darwin') throw new Error('The Pods package acceptance requires macOS')
await build({ targets: Platform.MAC.createTarget(['dir'], Arch.arm64), publish: 'never', config: { appId: 'ai.openape.pods.fixture', productName: 'OpenApe Pods Fixture', electronVersion: '40.9.3', directories: { output: 'release' }, files: ['dist/**/*', 'package.json'], asar: true, asarUnpack: ['dist/worker/**'], npmRebuild: false, mac: { category: 'public.app-category.productivity', identity: null, hardenedRuntime: false } } })
