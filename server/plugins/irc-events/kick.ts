import {IrcEventHandler} from "../../client";

import log from "../../log";
import Msg from "../../models/msg";

import {MessageType} from "../../../shared/types/msg";
import {ChanState} from "../../../shared/types/chan";

const MAX_RETRIES = 10;
const BACKOFF_DELAY = 30000;

const autorejoinState = new Map<string, {retryCount: number; timeout: NodeJS.Timeout}>();

function doAutoRejoin(client: any, irc: any, network: any, chanName: string) {
	const state = autorejoinState.get(chanName);

	if (state && state.retryCount >= MAX_RETRIES) {
		autorejoinState.delete(chanName);
		log.info(`Auto-rejoin failed for ${chanName} after ${MAX_RETRIES} attempts`);
		const msg = new Msg({
			type: MessageType.ERROR,
			text: `Auto-rejoin failed for ${chanName} after ${MAX_RETRIES} attempts. Please rejoin manually.`,
		});
		const chan = network.getChannel(chanName);

		if (chan) {
			chan.pushMessage(client, msg);
		}

		return;
	}

	const retryCount = state ? state.retryCount + 1 : 1;
	log.info(`Auto-rejoining channel ${chanName} (attempt ${retryCount}/${MAX_RETRIES})`);

	irc.join(chanName);

	const msg = new Msg({
		type: MessageType.NOTICE,
		text:
			retryCount === 1
				? `Attempting to automatically rejoin ${chanName}...`
				: `Retrying auto-rejoin for ${chanName} (attempt ${retryCount}/${MAX_RETRIES})...`,
	});

	const chan = network.getChannel(chanName);

	if (chan) {
		chan.pushMessage(client, msg);
	}

	const timeout = setTimeout(() => {
		doAutoRejoin(client, irc, network, chanName);
	}, BACKOFF_DELAY);

	autorejoinState.set(chanName, {retryCount, timeout});
}

export default <IrcEventHandler>function (irc, network) {
	const client = this;

	irc.on("irc error", function (data) {
		if (!data.channel) {
			return;
		}

		const state = autorejoinState.get(data.channel);

		if (!state) {
			return;
		}

		const errorMsg = data.error || "";

		if (
			errorMsg.toLowerCase().includes("too many join requests") ||
			errorMsg.toLowerCase().includes("please wait")
		) {
			log.info(`Auto-rejoin for ${data.channel} throttled, scheduling retry...`);
			return;
		}

		clearTimeout(state.timeout);
		autorejoinState.delete(data.channel);
	});

	irc.on("join", function (data) {
		if (autorejoinState.has(data.channel)) {
			const state = autorejoinState.get(data.channel);

			if (state) {
				clearTimeout(state.timeout);
			}

			autorejoinState.delete(data.channel);
			log.info(`Auto-rejoin succeeded for ${data.channel}`);
		}
	});

	irc.on("kick", function (data) {
		const chan = network.getChannel(data.channel!);

		if (typeof chan === "undefined") {
			return;
		}

		const user = chan.getUser(data.kicked!);
		const msg = new Msg({
			type: MessageType.KICK,
			time: data.time,
			from: chan.getUser(data.nick),
			target: user,
			text: data.message || "",
			highlight: data.kicked === irc.user.nick,
			self: data.nick === irc.user.nick,
		});
		chan.pushMessage(client, msg);

		if (data.kicked === irc.user.nick) {
			chan.users = new Map();
			chan.state = ChanState.PARTED;

			client.emit("channel:state", {
				chan: chan.id,
				state: chan.state,
			});

			// Auto-rejoin the channel if the setting is enabled for this network
			if (network.autoRejoin) {
				log.info(`Auto-rejoining channel ${chan.name} after being kicked by ${data.nick}`);

				setTimeout(() => {
					doAutoRejoin(client, irc, network, chan.name);
				}, 1000);
			}
		} else {
			chan.removeUser(user);
		}
	});
};
