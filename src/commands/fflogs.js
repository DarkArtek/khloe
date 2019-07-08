const { Command } = require('discord-akairo'),
	req = require('request-promise-native')

class FFLogsCommand extends Command {
	constructor() {
		super('fflogs', {
			aliases: ['fflogs', 'parse'],
			description: '',
			args: [
				{
					id: 'input',
					match: 'content'
				}
			]
		})
	}

	async exec(msg, { input }) {
		//isolate char name and/or server
		let { server, text } = this.client.utils.getServer(input, this.client.xiv.resources.servers)
		if(!server && !this.client.config.xiv.datacenter)
			return msg.util.send('You need to give me a valid server to look in!')

		try {
			msg.channel.startTyping()

			//get char from lodestone. prompt for server if uncertain
			let res = await this.client.xiv.character.search(text, {
				server: server ? server : `_dc_${this.client.config.xiv.datacenter}`
			})
			if(!res.results.length) {
				msg.util.send('Character not found :(')
				return msg.channel.stopTyping()
			}
			let chars = res.results

			let matches = 0, match
			for (const c of chars) {
				if(c.name.toLowerCase() === text.toLowerCase()) {
					matches++
					match = c
				}
			}

			let char
			if(matches == 1) {//single perfect match
				return await getRankings(match, msg, this.client)
			} else {//multiple or no matches, prompt
				if(match)
					char = match
				else
					char = chars[0]

				let embed = this.client.utils.toEmbed.characterFromSearch(char)
				msg.channel.stopTyping()
				let m = await msg.util.send('Is this the character you\'re looking for?', {embed: embed})
				let r = await this.client.utils.promptReaction(m, msg.author.id, ['✅','❌'])
				if(!r) return
				if(r.emoji.name === '✅') {
					msg.channel.startTyping()
					return await getRankings(char, msg, this.client)
				} else if(r.emoji.name === '❌') {
					msg.util.send('What\'s the character\'s server?')
					let m = await this.client.utils.promptMessage(msg.channel, msg.author.id)
					if(!r) return
					msg.channel.startTyping()
					res = await this.client.xiv.character.search(text, {server: m.content})
					if(!res.results.length) {
						msg.channel.send('Character not found :(')
						return msg.channel.stopTyping()
					}

					char = res.results.find(result => result.name.toLowerCase() === text.toLowerCase())
					return await getRankings(char, msg, this.client)
				}
			}

		} catch(err) {
			this.client.utils.throwError(err,msg)
			return msg.channel.stopTyping()
		}
	}
}

async function getRankings(char, msg, {utils, config}) {
	return new Promise(async (resolve, reject) => {
		try {
			let rankings = await req({
				uri: `https://www.fflogs.com:443/v1/rankings/character/${char.name}/${char.server}/${config.xiv.region}`,
				qs: {
					api_key: config.keys.fflogs,
					timeframe: 'historical'
				},
				json: true
			})

			if(!rankings.length) {
				msg.channel.send(`I couldn't find ${char.name} of ${char.server} on FF Logs (or they have no parses for this raid cycle).`)
				return resolve(msg.channel.stopTyping())
			}

			let encounters = []
			for (const rank of rankings) {
				if(!encounters.some(e => e.encounterName === rank.encounterName) || encounters.find(e => e.encounterName === rank.encounterName).percentile < rank.percentile) {
					encounters.push(rank)
				}
			}

			let percSum = 0, percNum = 0, highest
			for (const enc of encounters) {
				percNum++
				percSum += enc.percentile
				if(!highest || highest.percentile < enc.percentile)
					highest = enc
			}

			let embed = utils.toEmbed.fflogs(char, (Math.round((percSum / percNum) * 100) / 100), highest)
			msg.channel.send('', {embed:embed})
			return resolve(msg.channel.stopTyping())

		} catch(err) {
			reject(err)
		}
	})
}

module.exports = FFLogsCommand
