// get all urgent/overdue/unscheduled jobcards from db
// place them within a message template
// send to registered recipients
import 'dotenv/config';
import { createPool } from 'mariadb';
import { Bot, createBot } from 'whatsapp-cloud-api';
import {JobsResponse, createJobReport, getJobcards} from './jobcards.js'
import moment from 'moment';
import logger from './logger.js';

const pool = createPool({
    host: process.env.PROD_DB_HOST,
    port: parseInt(process.env.PROD_DB_PORT || '3306'),
    user: process.env.PROD_DB_USER,
    password: process.env.PROD_DB_PASS,
    database: process.env.PROD_DB_NAME,
})

const bot = createBot(
    process.env.PHONE_NUMBER_ID ?? '',
    process.env.ACCESS_TOKEN ?? '',
);

let records = new Map<string, {page: number, hasNextPage?: boolean, lastRequest: number}>();
try {
    await bot.startExpressServer({
        webhookVerifyToken: process.env.WEBHOOK_VERIFICATION_TOKEN ?? ''
    });
    bot.on('message', async (msg) => {
        const userLog = logger.child({user: msg.from})
        userLog.info('New message')
        try {
            if(msg.type !== 'text') {
                userLog.info({type: msg.type}, 'Unsupported message type')
                await bot.sendMessage(msg.from, 'Unsupported message type')
                return
            }
            const text = msg.data?.text?.trim().toLowerCase()
            let record = records.get(msg.from)
            
            if( text === "hey") {
                if(record && moment(record.lastRequest).diff(Date.now(), 'hours') < 12) {
                    const nextRequestTime = moment(record.lastRequest).add(12, 'hours').format('YYYY-MM-DD [at:] h:mm A')
                    await bot.sendMessage(msg.from, `Your last request was less than 12hours ago, job reminders are available in 12 hour intervals, request again as from ${nextRequestTime}`)
                    return
                }
                const res = await getJobcards(pool, 1)
                if(!res) {
                    await bot.sendText(msg.from, 'An error occured fetching jobcards, please try again \n')
                    return
                }
                await bot.sendText(msg.from, 'Hello from jobcards! \n')
                await sendReports(res, bot, msg.from)
                records.set(msg.from, {page: 1, hasNextPage: res?.hasNextPage, lastRequest: Date.now()})
                return
            }
            if( text === 'more') {
                if(record && moment(record.lastRequest).diff(Date.now(), 'hours') < 12) {
                    if(record.hasNextPage) {
                        await bot.sendMessage(msg.from, 'Fetching...')
                        let currentPage = record.page
                        const res = await getJobcards(pool, currentPage ? currentPage + 1 : 1)
                        if(!res) {
                            await bot.sendText(msg.from, 'An error occured fetching jobcards, please try again \n')
                            return
                        }
                        await sendReports(res, bot, msg.from)
                        records.set(msg.from, {page: currentPage ? currentPage + 1 : 1, hasNextPage: res.hasNextPage, lastRequest: record.lastRequest})
                    } else {
                        await bot.sendMessage(msg.from, 'No more jobs to show')
                    }
                } else {
                    await bot.sendMessage(msg.from, 'Text "Hey" to get the daily job reminders for today')
                }
                return
            }
            if(record?.hasNextPage) {
                await bot.sendMessage(msg.from, `Invalid! reply with 'more' for more jobs`)
            } else {
                await bot.sendMessage(msg.from, `Invalid reply, however, no more jobs available at this time`)
            }
            
        } catch (error) {
            userLog.error(error, 'Error serving user')
        }

    })
} catch (error) {
    logger.error(error, 'Uncaught error occured')
    bot.sendMessage(process.env.ADMIN_PHONE!, `An error occured in jobcard alert system: ${error}`)
        .catch(e=>logger.error(e, 'Error sending message alert'))
}

async function sendReports(res: JobsResponse, bot: Bot, recipient: string) {
    try {
        await bot.sendMessage(recipient, 'The following jobs are either overdue, scheduled, reported or unscheduled:')
        for (const job of res.jobcards) {
            await bot.sendMessage(recipient, createJobReport(job))
        }
        if(res.hasNextPage) {
            await bot.sendMessage(recipient, `Reply with 'more' for more jobs`);
        } else {
            await bot.sendMessage(recipient, `Thats all for now`);
        }
    } catch (error) {
        bot.sendMessage(recipient, `Apologies, an internal error occured`)
            .catch(e=>logger.error(e, 'Could not send error message to user'));
        throw error
    }
}