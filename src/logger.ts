import {pino} from 'pino'
import moment from 'moment'
const transport = pino.transport({
    targets: [
        {
            target: 'pino/file',
            options: {
                destination: `./app.log`
            }
        },
        {target: 'pino-pretty'}
    ]
})
export default pino({
    timestamp: ()=>`, "time":"${moment().format('YYYY-MM-DD [AT:] h:mm A')}"`,
   
}, transport)