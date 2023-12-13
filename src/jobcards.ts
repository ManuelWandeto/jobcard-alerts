import { Pool } from 'mariadb';
import moment from 'moment'
import logger from './logger.js';

export interface JobsResponse {
    hasNextPage: boolean, jobcards: Jobcard[]
}

export interface Jobcard {
    id: number,
    client: string,
    priority: 'URGENT' | 'MEDIUM' | 'LOW',
    description: string,
    assignee: string | null,
    supervisor: string | null,
    status: 'REPORTED' | 'SCHEDULED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED' | 'SUSPENDED',
    reported_on: Date,
    start_date: Date | null,
    end_date: Date | null,
    completion_notes: string | null,
    issues_arrising: string | null,
    files: string | null,
    created_at: Date
}

export async function getJobcards(pool: Pool, page = 1, pageSize = 5): Promise<JobsResponse | null> {
    const query = `
    SELECT 
        j.id, 
        c.name as client,
        j.priority,
        u.username as assignee,
        s.username as supervisor,
        j.reported_on,
        j.description,
        j.status,
        j.start_date,
        j.end_date,
        j.completion_notes,
        j.issues_arrising,
        GROUP_CONCAT(DISTINCT 'user_', a.uploaded_by, '/', a.file_name) as files,
        j.created_at
    FROM jc_jobcards as j
    INNER JOIN jc_clients as c
    ON j.client_id = c.id
    LEFT JOIN jc_users as u
    ON j.assigned_to = u.id
    LEFT JOIN jc_users as s
    ON j.supervised_by = s.id
    LEFT JOIN jc_attachments as a
    ON j.id = a.jobcard_id
    WHERE (status IN ('OVERDUE', 'SCHEDULED', 'REPORTED') AND priority = 'URGENT') OR COALESCE(j.start_date, j.end_date) IS NULL
    GROUP BY j.id
    ORDER BY created_at ASC, priority DESC, status DESC
    LIMIT ?
    OFFSET ?;
    `
    try {
        
        const jobcards = await pool.query<Jobcard[]>(query, [pageSize + 1, pageSize * (page - 1)])
        const hasNextPage = (jobcards.length < pageSize + 1) ? false : true
        if(hasNextPage) {
            jobcards.pop()
        }
        return {
            hasNextPage,
            jobcards
        }
    } catch (error) {
        logger.fatal(error, 'Error fetching jobcards')
        return null
    }
}

export function createJobReport(job: Jobcard) {
    const report =  
`
*priority:* ${job.priority}\n
*client:* ${job.client}\n
*description:* ${job.description}\n
*assignee:* ${job.assignee || "Unassigned"}\n
*status:* ${job.status}\n
*reported on:* ${moment(job.reported_on).format('YYYY-MM-DD [at:] h:mm A')}\n
*start date:* ${job.start_date ? moment(job.start_date).format('YYYY-MM-DD [at:] h:mm A') : 'Not set'}\n
*end date:* ${job.end_date ? moment(job.end_date).format('YYYY-MM-DD [at:] h:mm A') : 'Not set'}\n
${job.completion_notes?.trim() ? '*completion notes:* '+ job.completion_notes + '\n' : ''}
${job.issues_arrising?.trim() ? '*matters arrising:* '+ job.issues_arrising + '\n' : ''}
${job.files ? '- This jobcard has some attached files, login to the web app to view them': ''}\n
`
    return report
}