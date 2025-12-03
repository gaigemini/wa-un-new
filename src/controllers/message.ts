import type { proto, WAGenericMediaMessage, WAMessage } from "baileys";
import { downloadMediaMessage } from "baileys";
import { serializePrisma, delay as delayMs, logger, emitEvent } from "@/utils/index.js";
import type { RequestHandler } from "express";
import type { Message } from "@prisma/client";
import { prisma } from "@/config/database.js";
import WhatsappService from "@/whatsapp/service.js";
import { updatePresence } from "./misc.js";
import { WAPresence } from "@/types/index.js";

export const list: RequestHandler = async (req, res) => {
	try {
		const { sessionId } = req.params;
		const { cursor = undefined, limit = 25 } = req.query;
		const messages = (
			await prisma.message.findMany({
				cursor: cursor ? { pkId: Number(cursor) } : undefined,
				take: Number(limit),
				skip: cursor ? 1 : 0,
				where: { sessionId },
			})
		).map((m: Message) => serializePrisma(m));

		res.status(200).json({
			data: messages,
			cursor:
				messages.length !== 0 && messages.length === Number(limit)
					? messages[messages.length - 1].pkId
					: null,
		});
	} catch (e) {
		const message = "An error occured during message list";
		logger.error(e, message);
		res.status(500).json({ error: message });
	}
};

export const send: RequestHandler = async (req, res) => {
	try {
		const { jid, type = "number", message, options, quoted } = req.body;
		const sessionId = req.params.sessionId;
		const session = WhatsappService.getSession(sessionId)!;

		logger.info(req.body, `Sending message to ${jid}`);

		const validJid = await WhatsappService.validJid(session, jid, type);
		if (!validJid) return res.status(400).json({ error: "JID does not exists" });

		// Handle quoted message (reply)
		let finalOptions = options || {};
		if (quoted) {
			// Fetch the quoted message from database
			const quotedMessage = await prisma.message.findFirst({
				where: {
					sessionId,
					remoteJid: quoted.remoteJid || validJid,
					id: quoted.id,
				},
			});

			if (!quotedMessage) {
				return res.status(400).json({ error: "Quoted message not found" });
			}

			// Construct the quoted message object
			finalOptions = {
				...finalOptions,
				quoted: {
					key: quotedMessage.key as proto.IMessageKey,
					message: quotedMessage.message as proto.IMessage,
				},
			};
		}

		await updatePresence(session, WAPresence.Available, validJid);
		const result = await session.sendMessage(validJid, message, finalOptions);
		emitEvent("send.message", sessionId, { jid: validJid, result });
		res.status(200).json(result);
	} catch (e) {
		const message = "An error occured during message send";
		logger.error(e, message);
		emitEvent(
			"send.message",
			req.params.sessionId,
			undefined,
			"error",
			message + ": " + e,
		);
		res.status(500).json({ error: message });
	}
};

export const sendBulk: RequestHandler = async (req, res) => {
	const { sessionId } = req.params;
	const session = WhatsappService.getSession(sessionId)!;
	const results: { index: number; result: WAMessage | undefined }[] = [];
	const errors: { index: number; error: string }[] = [];

	for (const [
		index,
		{ jid, type = "number", delay = 1000, message, options, quoted },
	] of req.body.entries()) {
		try {
			const exists = await WhatsappService.jidExists(session, jid, type);
			if (!exists) {
				errors.push({ index, error: "JID does not exists" });
				continue;
			}

			if (index > 0) await delayMs(delay);

			// Handle quoted message (reply)
			let finalOptions = options || {};
			if (quoted) {
				const quotedMessage = await prisma.message.findFirst({
					where: {
						sessionId,
						remoteJid: quoted.remoteJid || jid,
						id: quoted.id,
					},
				});

				if (quotedMessage) {
					finalOptions = {
						...finalOptions,
						quoted: {
							key: quotedMessage.key as proto.IMessageKey,
							message: quotedMessage.message as proto.IMessage,
						},
					};
				}
			}

			await updatePresence(session, WAPresence.Available, jid);
			const result = await session.sendMessage(jid, message, finalOptions);
			results.push({ index, result });
			emitEvent("send.message", sessionId, { jid, result });
		} catch (e) {
			const message = "An error occured during message send";
			logger.error(e, message);
			errors.push({ index, error: message });
			emitEvent("send.message", sessionId, undefined, "error", message + ": " + e);
		}
	}

	res.status(req.body.length !== 0 && errors.length === req.body.length ? 500 : 200).json({
		results,
		errors,
	});
};

export const download: RequestHandler = async (req, res) => {
	try {
		const session = WhatsappService.getSession(req.params.sessionId)!;
		const message = req.body as WAMessage;
		const type = Object.keys(message.message!)[0] as keyof proto.IMessage;
		const content = message.message![type] as WAGenericMediaMessage;
		const buffer = await downloadMediaMessage(
			message,
			"buffer",
			{},
			{ logger, reuploadRequest: session.updateMediaMessage },
		);

		res.setHeader("Content-Type", content.mimetype!);
		res.write(buffer);
		res.end();
	} catch (e) {
		const message = "An error occured during message media download";
		logger.error(e, message);
		res.status(500).json({ error: message });
	}
};

export const deleteMessage: RequestHandler = async (req, res) => {
	try {
		const { sessionId } = req.params;
		const { jid, type = "number", message } = req.body;
		const session = WhatsappService.getSession(sessionId)!;

		const exists = await WhatsappService.jidExists(session, jid, type);
		if (!exists) return res.status(400).json({ error: "JID does not exists" });

		const result = await session.sendMessage(jid, { delete: message });

		res.status(200).json(result);
	} catch (e) {
		const message = "An error occured during message delete";
		logger.error(e, message);
		res.status(500).json({ error: message });
	}
};

export const deleteMessageForMe: RequestHandler = async (req, res) => {
	try {
		const { sessionId } = req.params;
		const { jid, type = "number", message } = req.body;
		const session = WhatsappService.getSession(sessionId)!;

		const exists = await WhatsappService.jidExists(session, jid, type);
		if (!exists) return res.status(400).json({ error: "JID does not exists" });

		const result = await session.chatModify({ clear: { messages: [message] } } as any, jid);

		res.status(200).json(result);
	} catch (e) {
		const message = "An error occured during message delete";
		logger.error(e, message);
		res.status(500).json({ error: message });
	}
};