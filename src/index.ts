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

let records = new Map<string, {status: string, page: number, hasNextPage?: boolean, lastRequest: number}>();
const statuses = ['CANCELLED','SUSPENDED','REPORTED','SCHEDULED','ONGOING','COMPLETED','OVERDUE']
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
            const text: string = msg.data?.text?.trim().toLowerCase()
            let record = records.get(msg.from)
            if(!record || moment(record.lastRequest).diff(Date.now(), 'hours') >= 24) {
                await bot.sendText(msg.from, 'Hello from jobcards! \n')
            }
            if(statuses.includes(text.toUpperCase())) {
                const res = await getJobcards(pool, text, 1)
                await sendReports(res!, text, bot, msg.from)
                records.set(msg.from, {status: text, page: 1, hasNextPage: res?.hasNextPage, lastRequest: Date.now()})
                return
            }
            if( text === 'more') {
                if(record) {
                    if(record.hasNextPage) {
                        await bot.sendMessage(msg.from, 'Fetching...')
                        let currentPage = record.page
                        const res = await getJobcards(pool, record.status, currentPage ? currentPage + 1 : 1)
                        if(!res) {
                            await bot.sendText(msg.from, 'An error occured fetching jobcards, please try again \n')
                            return
                        }
                        await sendReports(res, record.status, bot, msg.from)
                        records.set(msg.from, {
                            
                            page: currentPage ? currentPage + 1 : 1, 
                            hasNextPage: res.hasNextPage, 
                            status: record.status,
                            lastRequest: record.lastRequest
                        })
                    } else {
                        await bot.sendMessage(msg.from, `No more ${record.status} jobs to show for now`)
                    }
                } else {
                    await bot.sendMessage(msg.from, `Text either ${statuses.join(', ')} to get the daily job reminders for today`)
                }
                return
            }
            if(record?.hasNextPage) {
                await bot.sendMessage(msg.from, `Invalid! reply with 'more' for more jobs`)
            } else {
                await bot.sendMessage(msg.from, `Text either ${statuses.join(', ')} to get the daily job reminders for today`)
            }
            
        } catch (error) {
            await bot.sendText(msg.from, 'An error occured fetching jobcards, please try again \n')
            userLog.error(error, 'Error serving user')
        }

    })
} catch (error) {
    logger.error(error, 'Uncaught error occured')
    bot.sendMessage(process.env.ADMIN_PHONE!, `An error occured in jobcard alert system: ${error}`)
        .catch(e=>logger.error(e, 'Error sending message alert'))
}

async function sendReports(res: JobsResponse, status: string, bot: Bot, recipient: string) {
    try {
        await bot.sendMessage(recipient, `The following jobs are ${status.toUpperCase()}`)
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