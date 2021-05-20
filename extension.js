const vscode = require('vscode')
const {commands, window} = vscode
const {showInformationMessage, showWarningMessage, showErrorMessage, setStatusBarMessage} = window
const {showQuickPick, createTreeView, showOpenDialog, showInputBox} = window
const {registerCommand} = commands
const fs = require('fs')
const path = require('path')

//注册事件，生成左侧视图
const events = require('./src/bus')
const MapProvider = require('./src/views/map')
const SyncProvider = require('./src/views/sync')

//监听工作区，自动刷新视图
let watcher = null, syncProvider = null
const closeWatcher = () => watcher && watcher.close()
events.on('mpu:ready', service => {
	//映射区
	{
		const treeDataProvider = new MapProvider(service)
		createTreeView('mpuViewMap', { treeDataProvider })
	}
	//同步区
	{
		const treeDataProvider = syncProvider = new SyncProvider(service)
		createTreeView('mpuViewSync', { treeDataProvider })
	}
	//监听文件
	closeWatcher()
	watcher = fs.watch(service.rootPath, { recursive: false }, (eventType, name) => {
		//eventType:rename=新增/重命名/删除
		//name:文件名称
		console.log(eventType, name)
		if (name.test(/^\./)) {
			//.开头的文件夹不做任何处理（如.idea）
			return
		}
		service.init()
	})
})

//开始索引服务
const service = require('./src/service')

//注册命令 "miniprogram-ci": "^1.0.51", "regenerator-runtime": "^0.13.7",
// const ci = require('miniprogram-ci')
const ci = {}
const cp = require('child_process')
const os = require('os')
const util = require('./src/util')
const activate = (context) => {
	//切换启用状态
	context.subscriptions.push(registerCommand('mpu.toggleEnable', () => {
		service.toggleEnable().then(() => {
			if (service.config.enable) {
				showInformationMessage('小程序工具已启用')
			} else {
				showWarningMessage('小程序工具已禁用')
			}
		})
	}))

	//设为项目/更换模板
	const markAsProjectController = (viewItem) => {
		const templates = [...service.getAllTemplates()]
		if (!templates.length) {
			showWarningMessage('请先设置模板')
			return
		}
		showQuickPick(templates, { canPickMany: false, placeHolder: '请选择模板' }).then((template) => {
			if (!template) return
			service.markAsProject(viewItem.name, template).then(() => {
				showInformationMessage('设置成功')
				service.init()
			})
		})
	}
	context.subscriptions.push(registerCommand('mpu.markAsProject', markAsProjectController))
	context.subscriptions.push(registerCommand('mpu.changeTemplate', markAsProjectController))

	//取消设为项目
	context.subscriptions.push(registerCommand('mpu.cancelProject', (viewItem) => {
		showQuickPick(['确认', '取消'], { canPickMany: false, placeHolder: '将从模板下移除项目，确认操作？（不删除文件）' }).then(str => {
			if (!str || str == '取消') return
			service.cancelProject(viewItem.name).then(() => {
				showInformationMessage('设置成功')
				service.init()
			})
		})
	}))

	//设为模板
	context.subscriptions.push(registerCommand('mpu.markAsTemplate', (viewItem) => {
		service.markAsTemplate(viewItem.name).then(() => {
			showInformationMessage('设置成功')
			service.init()
		})
	}))

	//取消设为模板
	context.subscriptions.push(registerCommand('mpu.cancelTemplate', (viewItem) => {
		showQuickPick(['确认', '取消'], { canPickMany: false, placeHolder: '将移除模板下所有子项目，确认操作？（不删除文件）' }).then(str => {
			if (!str || str == '取消') return
			service.cancelTemplate(viewItem.name).then(() => {
				showInformationMessage('设置成功')
				service.init()
			})
		})
	}))

	/**
	 * 同步控制器工厂
	 * @param {Number} target 选取目标:1=文件夹,2=文件
	 * @param {Number} type   执行操作:1=模板到子项目,2=子项目到模板
	 * @returns {Function}    命令控制器
	 */
	const getSyncController = (target, type) => (viewItem) => {
		const {name} = viewItem
		const defaultUri = vscode.Uri.file(path.join(service.rootPath, name))
		const options = target == 1 
			? { canSelectFiles: false, canSelectFolders: true, canSelectMany: true, defaultUri, title: '选择文件夹', openLabel: '确认' }
			: { canSelectFiles: true, canSelectFolders: false, canSelectMany: true, defaultUri, title: '选择文件', openLabel: '确认' }
		showOpenDialog(options)
			.then((files) => {
				//打开窗口但未选择文件/取消
				if (!Array.isArray(files)) return
				if (type == 1) {
					//从模板拷贝到所有子项目
					syncProvider.syncToProjects(name, files)
				} else {
					//从子项目拷贝到模板
					syncProvider.syncToTemplate(name, files)
				}
			})
			.catch(e => console.log(e))
	}

	//同步文件夹到项目
	context.subscriptions.push(registerCommand('mpu.syncDirToProject', getSyncController(1, 1)))

	//同步文件到项目
	context.subscriptions.push(registerCommand('mpu.syncFileToProject', getSyncController(2, 1)))

	//同步文件夹到模板
	context.subscriptions.push(registerCommand('mpu.syncDirToTemplate',  getSyncController(1, 2)))

	//同步文件到模板
	context.subscriptions.push(registerCommand('mpu.syncFileToTemplate', getSyncController(2, 2)))

	const getPackageInstaller = () => {
		const installers = [
			{cmd: 'cnpm', args: ['install', '-g', 'miniprogram-ci']},
			{cmd: 'yarn', args: ['global', 'add', 'miniprogram-ci']},
			{cmd: 'npm', args: ['install', '-g', 'miniprogram-ci']},
		];
		let installer
		for (let i = 0; i < installers.length; i++) {
			try {
				cp.execSync(installers[i].cmd + ' -v')
				installer = installers[i]
				break
			} catch (e) {
				console.log(e)
				installer = ''
			}
		}
		if (!installer) {
			throw new Error('All installers are not available')
		}
		return installer
	}

	/**
	 * IDE控制器工厂
	 * @param {Number} type   执行操作:1=上传,2=预览,3=运行
	 * @returns {Function}    命令控制器
	 */
	const getIDEController = (type) => async (explorerItem) => {
		if (global.mpuIDERunning) {
			showWarningMessage(`${global.mpuIDERunning.name}正在运行中，请稍后...`)
			return
		}
		if (global.mpuIDEInstalling) {
			showWarningMessage(`环境安装中，请稍后...`)
			return
		}
		global.mpuIDEInstalling = false
		console.log('miniprogram-ci is checking...')
		let disposable = setStatusBarMessage('环境检测中...', 10000)
		try {
			let result = cp.execSync('miniprogram-ci --version')
			console.log(result.toString().trim())
		} catch (me) {
			let disposable2 = setStatusBarMessage('自动安装环境中...', 600000)
			try {
				global.mpuIDEInstalling = true
				const installer = getPackageInstaller()
				console.log(installer)
				await new Promise((resolve) => {
					const run = cp.spawn(installer.cmd + (process.platform === 'win32' ? '.cmd' : ''), installer.args)
					run.stdout.on('data', (data) => {
						let result = data.toString().trim()
						console.log(result)
						setStatusBarMessage(result, 1000)
					});
					run.stderr.on('data', (data) => {
						let result = data.toString().trim()
						console.log(result)
						setStatusBarMessage(result, 1000)
					});
					run.on('close', (code) => {
						if (code !== 0) {
							resolve()
						}
					});
				})
				let result = cp.execSync('miniprogram-ci --version')
				console.log(result.toString().trim())
			} catch (e) {
				console.log(e)
				showErrorMessage(`环境异常，请手动运行 "npm install -g miniprogram-ci" 安装环境`)
				global.mpuIDEInstalling = false
				return
			} finally {
				global.mpuIDEInstalling = false
				disposable2.dispose()
			}
		} finally {
			disposable.dispose()
		}
		console.log('miniprogram-ci is ok')
		const {fsPath} = explorerItem
		const rootPath = service.rootPath
		const name = fsPath.replace(rootPath, '').replace(new RegExp('^\\' + path.sep), '').split(path.sep)[0]
		const projectPath = path.join(rootPath, name)
		const configPath = path.join(projectPath, 'project.config.json')
		if (!fs.existsSync(configPath)) {
			showErrorMessage(`${name}没有project.config.json文件`)
			global.mpuIDEInstalling = false
			return
		}
		const configContent = fs.readFileSync(configPath, {encoding:'utf-8'})
		let projectConfig
		try {
			projectConfig = JSON.parse(configContent)
			if (!projectConfig || !projectConfig.appid) {
				throw new Error('没有APPID')
			}
		} catch (e) {
			showErrorMessage(`${name}的project.config.json文件不合法`)
			global.mpuIDEInstalling = false
			return
		}
		const {appid, setting: {es6, enhance: es7, minified: minify}} = projectConfig
		const setting = { es6, es7, minify }
		const privateKeyDir = path.join(service.ideaRoot, 'keys')
		if (!fs.existsSync(privateKeyDir)) {
			const command = `${os.platform() === 'win32' ? 'md' : 'mkdir -p'} ${privateKeyDir}`
			console.log(command)
			cp.execSync(command)
		}
		const privateKeyPath = path.join(privateKeyDir, `private.${appid}.key`)
		global.mpuIDERunning = {name, appid}
		try {
			await new Promise((resolve, reject) => {
				if (fs.existsSync(privateKeyPath)) {
					resolve()
				} else {
					const defaultUri = vscode.Uri.file(path.join(service.rootPath, name))
					const filters = { '*.key': ['key'] }
					showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, defaultUri, filters, title: '选择私钥文件', openLabel: '确认' })
						.then((files) => {
							if (!Array.isArray(files)) {
								reject('取消选择')
								return
							}
							const keySourcePath = path.normalize(files[0].path).replace(/^\\/, '')
							try {
								const command = `${os.platform() === 'win32' ? 'copy /Y' : 'cp'} ${keySourcePath} ${privateKeyPath}`
								console.log(command)
								cp.execSync(command)
								resolve()
							} catch (e) {
								console.log(e)
								reject('私钥文件复制失败')
							}
						})
						.catch(e => reject(e))
				}
			})
		} catch (e) {
			console.log(e)
			showErrorMessage(`${name}没有私钥文件，请到微信“小程序后台 - 开发 - 开发设置 - 小程序代码上传”获取`)
			global.mpuIDEInstalling = false
			return
		}
		// const ciConfig = { appid, type: 'miniProgram', projectPath, privateKeyPath, ignores: ['node_modules/**/*'] }
		// const project = new ci.Project(ciConfig)
		const showError = (msg, err) => {
			try {
				err = err && err.toString() ? err.toString() : ''
				let match = err.match(/{.*?}/) || [err]
				if (err.indexOf('private key file') !== -1) {
					match = ['私钥文件错误，请重新选择']
					fs.unlinkSync(privateKeyPath)
				}
				if (err.indexOf('invalid ip') !== -1) {
					let ip = err.match(/(?:\d+\.){3}\d+/)
					match = [`${ip[0]}不在IP白名单内，请到小程序后台修改设置`]
				}
				showErrorMessage(`${msg}: ${match[0]}`)
			} catch (e) {
				console.log(e)
			}
		}
		/* const showResult = (msg, result) => {
			const {subPackageInfo} = result
			let appSize = 0, fullSize = 0, packageCount = 0, packageSize = 0
			subPackageInfo.forEach(v => {
				const {name, size} = v
				if (name === '__APP__') {
					appSize += size
				} else if (name === '__FULL__') {
					fullSize += size
				} else {
					packageCount += 1
					packageSize += size
				}
			})
			console.log(`主包：${util.humansize(appSize)}；分包：${util.humansize(packageSize)}，共${packageCount}个`)
			showInformationMessage(`${msg}，编译后代码包大小：${util.humansize(fullSize)}`)
		} */
		try {
			switch (type) {
				//上传
				case 1:
					try {
						let version = ''
						let desc = ''
						await new Promise((resolve, reject) => {
							showInputBox({
								ignoreFocusOut: true,
								password: false,
								placeHolder: '请输入版本号+描述（非必填）',
								prompt: '例：1.0.0@hello'
							}).then(v => {
								const str = v || ''; [version, desc] = str.split('@')
								if (!version) {
									version = '1.0.0'
								}
								if (!desc) {
									desc = `${(new Date()).toLocaleString()}上传`
								}
								resolve()
							}).catch(reject)
						})
						try {
							/* const uploadResult = await ci.upload({project, version, desc, setting, onProgressUpdate: (task) => {
								if (task && task._msg) {
									//doing pages/shop/goods/index
									setStatusBarMessage(`[${task._status}] ${task._msg}`, 1000)
								} else {
									//run task busy
									console.log(task)
								}
							}})
							showResult('上传成功', uploadResult) */
							let args = [
								'upload',
								'--pp', projectPath,
								'--pkp', privateKeyPath,
								'--appid', appid,
								'--uv', version,
								'--ud', desc,
								'--r', 1,
								'--enable-es6', setting.es6 ? true : false,
								'--enable-es7', setting.es6 ? true : false,
								'--enable-minify', setting.es6 ? true : false,
							];
							await new Promise((resolve, reject) => {
								const run = cp.spawn('miniprogram-ci' + (process.platform === 'win32' ? '.cmd' : ''), args)
								run.stdout.on('data', (data) => {
									let result = data.toString().trim()
									// console.log('stdout> ' + result)
									setStatusBarMessage(result, 1000)
								});
								run.stderr.on('data', (data) => {
									let result = data.toString().trim()
									// console.log('stderr> ' + result)
									setStatusBarMessage(result, 1000)
									result && !/worker thread/.test(result) && reject(result)
								});
								run.on('close', (code) => {
									console.log('code:' + code)
									resolve()
								});
							})
							showInformationMessage(util.timeStr() + name + '上传成功')
						} catch (e) {
							showError(util.timeStr() + name + '上传失败', e)
						}
					} catch (e) {
						//取消输入
						console.log(e)
						global.mpuIDEInstalling = false
					}
					break
				//预览
				case 2:
					try {
						let version = ''
						let desc = ''
						let mpPath = undefined
						let pagePath = undefined
						let searchQuery = undefined
						await new Promise((resolve, reject) => {
							showInputBox({
								ignoreFocusOut: true,
								password: false,
								placeHolder: '请输入版本号+描述+路径（非必填）',
								prompt: '例：1.0.0@商品详情@pages/shop/goods/detail?goods_id=1'
							}).then(v => {
								const str = v || ''; [version, desc, mpPath] = str.split('@')
								if (!version) {
									version = '1.0.0'
								}
								if (!desc) {
									desc = `${(new Date()).toLocaleString()}上传`
								}
								mpPath = mpPath || ''; [pagePath, searchQuery] = mpPath.split('?')
								if (!pagePath) pagePath = undefined
								//预览参数 [注意!]这里的`&`字符在命令行中应写成转义字符`\&`
								if (!searchQuery) searchQuery = undefined
								resolve()
							}).catch(reject)
						})
						try {
							let qrcodeFormat = 'image'
							let qrcodeOutputDir = path.join(service.ideaRoot, 'preview')
							if (!fs.existsSync(qrcodeOutputDir)) util.mkdirs(qrcodeOutputDir)
							if (!fs.existsSync(qrcodeOutputDir)) throw new Error('预览码文件夹生成失败')
							let qrcodeOutputDest = path.join(qrcodeOutputDir, `${appid}.png`)
							/* const previewResult = await ci.preview({project, desc, setting, qrcodeFormat, qrcodeOutputDest, pagePath, searchQuery, onProgressUpdate: (task) => {
								if (task && task._msg) {
									//doing pages/shop/goods/index
									setStatusBarMessage(`[${task._status}] ${task._msg}`, 1000)
								} else {
									//run task busy
									console.log(task)
								}
							}}) 
							showResult('预览成功', previewResult)*/
							let args = [
								'preview',
								'--pp', projectPath,
								'--pkp', privateKeyPath,
								'--appid', appid,
								'--uv', version,
								'--ud', desc,
								'--r', 1,
								'--enable-es6', setting.es6 ? true : false,
								'--enable-es7', setting.es6 ? true : false,
								'--enable-minify', setting.es6 ? true : false,
								'--qrcode-format', qrcodeFormat,
								'--qrcode-output-dest', qrcodeOutputDest,
							];
							if (pagePath) args = args.concat(['--preview-page-path', pagePath])
							if (searchQuery) args = args.concat(['--preview-search-query', searchQuery.replace(/\&/g, '\\\&')])
							await new Promise((resolve, reject) => {
								const run = cp.spawn('miniprogram-ci' + (process.platform === 'win32' ? '.cmd' : ''), args)
								run.stdout.on('data', (data) => {
									let result = data.toString().trim()
									// console.log('stdout> ' + result)
									setStatusBarMessage(result, 1000)
								});
								run.stderr.on('data', (data) => {
									let result = data.toString().trim()
									// console.log('stderr> ' + result)
									setStatusBarMessage(result, 1000)
									result && !/worker thread/.test(result) && reject(result)
								});
								run.on('close', (code) => {
									console.log('code:' + code)
									resolve()
								});
							})
							await commands.executeCommand('vscode.open', vscode.Uri.file(qrcodeOutputDest))
							showInformationMessage(util.timeStr() + name + '预览成功')
						} catch (e) {
							showError(util.timeStr() + name + '预览失败', e)
						}
					} catch (e) {
						//取消输入
						console.log(e)
						global.mpuIDEInstalling = false
					}
					break
				//运行
				case 3:
					const command = `miniprogram-ci open --project-path ${projectPath} --appid ${appid} --privateKeyPath ${privateKeyPath}`
					const cwd = context.extensionPath
					console.log(command)
					cp.exec(command, {cwd}, (error, stdout, stderr) => {
						if (error) {
							console.error(`error: ${error}`)
							showErrorMessage(util.timeStr() + name + `运行失败`)
							global.mpuIDERunning = false
							return
						}
						if (stderr) {
							showErrorMessage(util.timeStr() + name + `运行失败`)
						} else {
							showInformationMessage(util.timeStr() + '运行成功，如果工具未成功开启，请手动打开工具开启“设置 - 安全 - 服务端口”')
						}
					})
					break
			}
		} finally {
			global.mpuIDERunning = false
		}
	}

	//上传项目
	context.subscriptions.push(registerCommand('mpu.uploadProject', getIDEController(1)))

	//预览项目
	context.subscriptions.push(registerCommand('mpu.previewProject', getIDEController(2)))

	//运行项目
	context.subscriptions.push(registerCommand('mpu.runProject', getIDEController(3)))
}

const deactivate = () => {
	closeWatcher()
}

module.exports = {
	activate,
	deactivate
}
