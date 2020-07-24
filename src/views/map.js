const vscode = require('vscode')
const {EventEmitter, TreeItem, TreeItemCollapsibleState} = vscode
const path = require('path')

class MapProvider {
	constructor(service) {
		this.service = service
		this._onDidChangeFile  = new EventEmitter()
	}

	get onDidChangeFile() {
		return this._onDidChangeFile.event
	}

	async getChildren() {
		const list = []
		for (let i = 0; i < this.service.dirList.length; i++) {
			let name = this.service.dirList[i]
			list.push({
				name,
				template: this.service.isTemplate(name),
				project: this.service.isProject(name),
			})
		}
		return list
	}

	getTreeItem(element) {
		const treeItem = new TreeItem(element.name, TreeItemCollapsibleState.None)
		let contextValue = 'mpu:map:' + element.name
		treeItem.iconPath = {
			light: path.join(__filename, '..', '..', '..', 'resources', 'light', 'document.svg'),
			dark: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'document.svg'),
		}
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
}

module.exports = MapProvider