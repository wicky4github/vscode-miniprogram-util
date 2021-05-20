const vscode = require('vscode')
const {EventEmitter, TreeItem, TreeItemCollapsibleState, window, ProgressLocation} = vscode
const {showInformationMessage, showErrorMessage, withProgress} = window
const path = require('path')
const util = require('../util')
const parser = require('gitignore-parser')
const fs = require('fs')
const os = require('os')
const isWin = os.platform() === 'win32'

class SyncProvider {
	constructor(service) {
		this.service = service
		this._onDidChangeFile  = new EventEmitter()
		this.compileList = {}
	}

	get onDidChangeFile() {
		return this._onDidChangeFile.event
	}

	async getChildren(element) {
		if (element) {
			return [...this.service.getProjects(element.name)].map(name => ({name, template: false, project: true}))
		}

		return [...this.service.getAllTemplates()].map(name => ({name, template: true, project: false}))
	}

	getTreeItem(element) {
		const treeItem = new TreeItem(element.name, element.template ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None)
		let contextValue = 'mpu:sync:' + element.name
		if (element.project) {
			contextValue += '+proj'
			treeItem.iconPath = {
				light: path.join(__filename, '..', '..', '..', 'resources', 'light', 'folder.svg'),
				dark: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'folder.svg'),
			}
		}
		if (element.template) {
			contextValue += '+tpl'
			treeItem.iconPath = {
				light: path.join(__filename, '..', '..', '..', 'resources', 'light', 'dependency.svg'),
				dark: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'dependency.svg'),
			}
		}
		treeItem.contextValue = contextValue
		return treeItem
	}
	
	syncToProjects(name, files) {
		return withProgress({
            location: ProgressLocation.Notification,
            title: 'Synchronizing...',
            cancellable: false
        }, async (progress) => {
			const projects = [...this.service.getProjects(name)]
			let currLoop = 0
			for (let i = 0; i < projects.length; i++) {
				for (let j = 0; j < files.length; j++) {
					const templatePath = path.normalize(files[j].path).replace(/^\\/, '')
					const targetPath = templatePath.replace(name, projects[i])
					util.copy(templatePath, targetPath, (dest) => !this.isNonReplacable(projects[i], dest))

					progress.report({ increment: Math.ceil(((++currLoop) / (projects.length * files.length)) * 100) })
				}
			}
			this.compileList = []
            return Promise.resolve()
        }).then(() => showInformationMessage(util.timeStr() + '同步成功')).catch(() => showErrorMessage(util.timeStr() + '同步失败'))
	}

	syncToTemplate(name, files) {
		return withProgress({
            location: ProgressLocation.Notification,
            title: 'Synchronizing...',
            cancellable: false
        }, async (progress) => {
			const template = this.service.getTemplate(name)
			let currLoop = 0
			for (let j = 0; j < files.length; j++) {
				const projectPath = path.normalize(files[j].path).replace(/^\\/, '')
				const targetPath = projectPath.replace(name, template)
				util.copy(projectPath, targetPath, (dest) => !this.isNonReplacable(template, dest))

				progress.report({ increment: Math.ceil((++currLoop) / files.length * 100) })
			}
			this.compileList = []
            return Promise.resolve()
        }).then(() => showInformationMessage(util.timeStr() + '同步成功')).catch(() => showErrorMessage(util.timeStr() + '同步失败'))
	}

	//判断路径是否不可替换
	isNonReplacable(targetName, targetDest) {
		if (isWin) targetDest = targetDest.toLowerCase()
		//默认禁止替换
		const rules = [/env(\.[\d\w]+)*\.js/, /^\./]
		let match = null
		for (let i = 0; i < rules.length; i++) {
			const rule = rules[i]
			if (rule instanceof RegExp ? rule.test(targetDest) : targetDest.indexOf(rule) !== -1) {
				match = rule.toString()
			}
		}
		//解析gitignore
		const projectPath = path.join(this.service.rootPath, targetName)
		const ignoreFile = path.join(projectPath, '.gitignore')
		let gitignore = this.compileList[ignoreFile]
		if (!gitignore) {
			if (fs.existsSync(ignoreFile)) {
				this.compileList[ignoreFile] = gitignore = parser.compile(fs.readFileSync(ignoreFile, 'utf8'))
			}
		}
		const relativePath = targetDest.replace(projectPath, '').replace(new RegExp(`^\\${path.sep}`), '')
		if (gitignore && gitignore.denies(relativePath)) {
			match = '.gitignore'
		}
		
		return match
	}
}

module.exports = SyncProvider